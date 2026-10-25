"""How the game model has done on the games it predicted: calibration (does a
predicted 70% win ~70% of the time?), accuracy, Brier and log-loss.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from tipsheet.db.models import Prediction, PredictionEvaluation


def calibration_table(pairs: list[tuple[float, bool]], n_bins: int = 5) -> list[dict]:
    """Bucket (predicted_home_win_prob, actual_home_win) pairs into probability
    bins and compare average predicted probability to the realized win rate.
    """
    bins: list[list[tuple[float, bool]]] = [[] for _ in range(n_bins)]
    for prob, actual in pairs:
        idx = min(int(prob * n_bins), n_bins - 1)
        bins[idx].append((prob, actual))

    rows = []
    for i, bucket in enumerate(bins):
        if not bucket:
            continue
        avg_pred = sum(p for p, _ in bucket) / len(bucket)
        actual_rate = sum(1 for _, a in bucket if a) / len(bucket)
        rows.append({
            "bin": f"{i / n_bins:.1f}-{(i + 1) / n_bins:.1f}",
            "n": len(bucket),
            "avg_predicted": round(avg_pred, 3),
            "actual_win_rate": round(actual_rate, 3),
        })
    return rows


def build_report(session: Session, model_version: str, n_bins: int = 5) -> dict:
    """Assemble the backtest report for all evaluated predictions of a model_version."""
    rows = session.execute(
        select(
            Prediction.predicted_home_win_prob,
            PredictionEvaluation.actual_home_win,
            PredictionEvaluation.brier_score,
            PredictionEvaluation.log_loss,
            PredictionEvaluation.correctly_picked_winner,
        )
        .join(PredictionEvaluation, PredictionEvaluation.prediction_id == Prediction.id)
        .where(Prediction.model_version == model_version)
    ).all()

    if not rows:
        return {"model_version": model_version, "n": 0}

    n = len(rows)
    pairs = [(float(r.predicted_home_win_prob), r.actual_home_win) for r in rows]
    hits = sum(1 for r in rows if r.correctly_picked_winner)

    return {
        "model_version": model_version,
        "n": n,
        "winner_accuracy": round(hits / n, 3),
        "mean_brier": round(sum(float(r.brier_score) for r in rows) / n, 4),
        "mean_log_loss": round(sum(float(r.log_loss) for r in rows) / n, 4),
        "calibration": calibration_table(pairs, n_bins),
    }
