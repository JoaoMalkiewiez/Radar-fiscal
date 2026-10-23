#!/usr/bin/env python3
"""Collect SEFAZ status transitions and persist a bounded incident history."""

from __future__ import annotations

import concurrent.futures
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_URL = "https://monitor.tecnospeed.com.br/monitores"
STATUS_PAGE_URL = "https://monitor.tecnospeed.com.br/"
DOCS = ("nfe", "nfce", "cte")
UFS = (
    "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go",
    "ma", "mt", "ms", "mg", "pa", "pb", "pr", "pe", "pi",
    "rj", "rn", "rs", "ro", "rr", "sc", "sp", "se", "to",
)
OUTAGE_STATUSES = {3, 4, 5}
STATUS_LABELS = {3: "muito_lento", 4: "timeout", 5: "erro"}
VALID_STATUSES = {1, 2, 3, 4, 5}


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


def parse_status(value: object) -> int | None:
    """TecnoSpeed may serialize a numeric status as e.g. '1.0000'."""
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if not number.is_integer():
        return None
    status = int(number)
    return status if status in VALID_STATUSES else None


def fetch_worker_status(doc: str, uf: str) -> tuple[str, str, int | None, str | None]:
    """Return (doc, UF, status, detail); missing workers are not treated as normal."""
    worker_id = f"sefaz_{doc}_envio_{uf}"
    query = urllib.parse.urlencode({"current": "true", "worker_id": worker_id})
    request = urllib.request.Request(
        f"{API_URL}?{query}",
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Referer": STATUS_PAGE_URL,
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status != 200:
                return doc, uf.upper(), None, f"HTTP {response.status}"
            raw = response.read()
        payload = json.loads(raw.decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return doc, uf.upper(), None, str(error)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        return doc, uf.upper(), None, f"Resposta inválida: {error}"

    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        return doc, uf.upper(), None, "Formato inesperado na resposta"

    for item in payload:
        if not isinstance(item, dict):
            continue
        returned_worker = str(item.get("id_worker") or "")
        # Never attribute a result from one worker to a different document/UF.
        if returned_worker and returned_worker != worker_id:
            continue
        status = parse_status(item.get("status"))
        if status is not None:
            return doc, uf.upper(), status, None

    return doc, uf.upper(), None, None


def fetch_all_statuses() -> tuple[dict[str, dict[str, int]], dict[str, str]]:
    statuses: dict[str, dict[str, int]] = {doc: {} for doc in DOCS}
    errors: dict[str, list[str]] = {doc: [] for doc in DOCS}
    tasks = [(doc, uf) for doc in DOCS for uf in UFS]

    # Parallel requests keep the whole collection within the five-minute interval.
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        futures = [executor.submit(fetch_worker_status, doc, uf) for doc, uf in tasks]
        for future in concurrent.futures.as_completed(futures):
            doc, uf, status, detail = future.result()
            if status is not None:
                statuses[doc][uf] = status
            elif detail:
                errors[doc].append(f"{uf}: {detail}")

    summary_errors: dict[str, str] = {}
    for doc in DOCS:
        print(f"{doc.upper()}: {len(statuses[doc])} UFs com status recebidos")
        if errors[doc]:
            print(f"{doc.upper()}: {len(errors[doc])} erros de requisição; exemplo: {errors[doc][0]}", file=sys.stderr)
        if not statuses[doc]:
            summary_errors[doc] = (
                f"Nenhum status válido recebido para {doc.upper()}. "
                f"Erros de requisição: {len(errors[doc])}; "
                f"exemplo: {errors[doc][0] if errors[doc] else 'a fonte retornou lista vazia ou worker não encontrado'}"
            )
    return statuses, summary_errors


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

    statuses_by_doc, errors = fetch_all_statuses()
    for doc, detail in errors.items():
        print(f"AVISO: {detail}", file=sys.stderr)

    # Do not update trackingSince if a whole document could not be queried.
    successful_docs = sum(bool(statuses_by_doc[doc]) for doc in DOCS)
    if successful_docs == 0:
        raise RuntimeError("Nenhuma consulta válida da TecnoSpeed; o histórico foi preservado.")

    now = utc_now()
    incidents: list[dict] = history["incidents"]
    updated = False

    for doc in DOCS:
        for uf, status in statuses_by_doc[doc].items():
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
                active["durationSeconds"] = max(
                    0, int((recovered_at - detected_at).total_seconds())
                )
                print(f"Serviço normalizado: {doc.upper()} {uf}")
                updated = True

    if successful_docs > 0 and not history.get("trackingSince"):
        history["trackingSince"] = iso(now)
        updated = True

    if not updated:
        print("Nenhuma mudança de instabilidade detectada; histórico preservado sem novo commit.")
        return 0

    # Keep up to 300 events and retain every currently open incident.
    active_incidents = [item for item in incidents if not item.get("recoveredAt")]
    closed_incidents = sorted(
        (item for item in incidents if item.get("recoveredAt")),
        key=lambda item: str(item.get("detectedAt") or ""),
    )
    keep_closed = max(0, 300 - len(active_incidents))
    retained_closed = closed_incidents[-keep_closed:] if keep_closed else []
    history["incidents"] = sorted(
        retained_closed + active_incidents,
        key=lambda item: str(item.get("detectedAt") or ""),
    )
    history["schemaVersion"] = 1
    if not history.get("trackingSince"):
        history["trackingSince"] = iso(now)
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
