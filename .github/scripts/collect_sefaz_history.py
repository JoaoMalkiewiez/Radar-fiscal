#!/usr/bin/env python3
"""Collect observed SEFAZ outages and persist incident transitions on a data branch."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_URL = "https://monitor.tecnospeed.com.br/monitores"
DOCS = ("nfe", "nfce", "cte")
OUTAGE_STATUSES = {3, 4, 5}
STATUS_LABELS = {3: "muito_lento", 4: "timeout", 5: "erro"}
WORKER_RE = re.compile(r"^sefaz_(nfe|nfce|cte)_envio_([a-z]{2})$")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_timestamp(value: object, fallback: datetime) -> datetime:
    if not isinstance(value, str) or not value.strip():
        return fallback
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return fallback


def fetch_doc_statuses(doc: str) -> dict[str, int]:
    query = urllib.parse.urlencode({"stateStatus": "true", "doc": doc})
    request = urllib.request.Request(
        f"{API_URL}?{query}",
        headers={
            "Accept": "application/json",
            "Referer": "https://monitor.tecnospeed.com.br/",
            "User-Agent": "RadarFiscal-SEFAZ-History/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status} ao consultar {doc}")
        payload = json.loads(response.read().decode("utf-8"))

    if not isinstance(payload, list):
        raise RuntimeError(f"Resposta inesperada da TecnoSpeed para {doc}")

    statuses: dict[str, int] = {}
    for item in payload:
        if not isinstance(item, dict):
            continue
        match = WORKER_RE.match(str(item.get("id_worker") or ""))
        if not match or match.group(1) != doc:
            continue
        try:
            status = int(item.get("status"))
        except (TypeError, ValueError):
            continue
        if status not in {1, 2, 3, 4, 5}:
            continue
        statuses[match.group(2).upper()] = status
    return statuses


def latest_open_incident(incidents: list[dict], key: str) -> dict | None:
    for incident in reversed(incidents):
        if incident.get("key") == key and not incident.get("recoveredAt"):
            return incident
    return None


def main() -> int:
    history_path = Path(os.environ.get("HISTORY_FILE", "history.json"))
    if not history_path.exists():
        raise RuntimeError(f"Arquivo de histórico não encontrado: {history_path}")

    with history_path.open("r", encoding="utf-8") as handle:
        history = json.load(handle)
    if not isinstance(history, dict) or not isinstance(history.get("incidents"), list):
        raise RuntimeError("Estrutura inválida em history.json; nenhum dado foi sobrescrito.")

    now = utc_now()
    incidents: list[dict] = history["incidents"]
    updated = False
    successful_docs = 0

    for doc in DOCS:
        try:
            statuses = fetch_doc_statuses(doc)
            successful_docs += 1
        except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as error:
            print(f"AVISO: consulta de {doc} falhou: {error}", file=sys.stderr)
            continue

        for uf, status in statuses.items():
            key = f"{doc}:{uf}"
            active = latest_open_incident(incidents, key)

            if status in OUTAGE_STATUSES:
                if active is None:
                    incident_time = iso(now)
                    incidents.append(
                        {
                            "id": f"{doc}-{uf}-{now.strftime('%Y%m%dT%H%M%SZ')}",
                            "key": key,
                            "document": doc,
                            "uf": uf,
                            "detectedAt": incident_time,
                            "recoveredAt": None,
                            "durationSeconds": None,
                            "maxSeverity": status,
                            "statusLabel": STATUS_LABELS[status],
                        }
                    )
                    print(f"Nova instabilidade: {doc.upper()} {uf} ({STATUS_LABELS[status]})")
                    updated = True
                elif status > int(active.get("maxSeverity", 0)):
                    active["maxSeverity"] = status
                    active["statusLabel"] = STATUS_LABELS[status]
                    active["severityUpdatedAt"] = iso(now)
                    print(f"Severidade aumentou: {doc.upper()} {uf} ({STATUS_LABELS[status]})")
                    updated = True
            elif status == 1 and active is not None:
                detected_at = parse_timestamp(active.get("detectedAt"), now)
                recovered_at = max(now, detected_at)
                active["recoveredAt"] = iso(recovered_at)
                active["durationSeconds"] = max(0, int((recovered_at - detected_at).total_seconds()))
                print(f"Serviço normalizado: {doc.upper()} {uf}")
                updated = True

    if successful_docs == 0:
        raise RuntimeError("As três consultas à TecnoSpeed falharam; o histórico foi preservado.")

    if not updated:
        print("Nenhuma mudança de instabilidade detectada; histórico preservado sem novo commit.")
        return 0

    # Keep a bounded history while never removing active incidents.
    active_incidents = [item for item in incidents if not item.get("recoveredAt")]
    closed_incidents = sorted(
        (item for item in incidents if item.get("recoveredAt")),
        key=lambda item: str(item.get("detectedAt") or ""),
    )
    keep_closed = max(0, 300 - len(active_incidents))
    history["incidents"] = sorted(
        closed_incidents[-keep_closed:] + active_incidents if keep_closed else active_incidents,
        key=lambda item: str(item.get("detectedAt") or ""),
    )
    history.setdefault("schemaVersion", 1)
    history.setdefault("trackingSince", iso(now))
    history["updatedAt"] = iso(now)

    temporary_path = history_path.with_suffix(".json.tmp")
    with temporary_path.open("w", encoding="utf-8") as handle:
        json.dump(history, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    temporary_path.replace(history_path)
    print(f"Histórico atualizado: {len(history['incidents'])} incidentes registrados.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERRO: {error}", file=sys.stderr)
        raise SystemExit(1)
