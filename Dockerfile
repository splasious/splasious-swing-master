# Swing Master dashboard for self-hosting (not for the TradingMaster server --
# Swing Master only reads TradingMaster's API as a data feed).
# Standard library only: no pip install step.
FROM python:3.12-slim

WORKDIR /app
COPY swing_master ./swing_master
COPY sample_data ./sample_data

ENV PYTHONUNBUFFERED=1 \
    SM_HOST=0.0.0.0 \
    SM_PORT=8765 \
    SM_STATE_DIR=/data

RUN useradd --create-home --uid 10001 swing && mkdir -p /data && chown swing /data
USER swing
VOLUME ["/data"]
EXPOSE 8765

# listening on 0.0.0.0 requires SM_ACCESS_PASSWORD (the server refuses to start otherwise)
HEALTHCHECK --interval=60s --timeout=5s --start-period=600s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/', timeout=4)" || exit 1

CMD ["python", "-m", "swing_master.main", "serve"]
