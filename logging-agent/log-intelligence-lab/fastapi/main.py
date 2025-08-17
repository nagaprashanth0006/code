from fastapi import FastAPI, HTTPException
import logging, random, time, os

app = FastAPI(title="FastAPI Demo")

# logging
os.makedirs("logs", exist_ok=True)
logger = logging.getLogger("fastapi")
logger.setLevel(logging.DEBUG)
fmt = logging.Formatter('[%(asctime)s] %(levelname)s in %(module)s: %(message)s')
fh = logging.FileHandler("logs/fastapi.log")
fh.setFormatter(fmt)
ch = logging.StreamHandler()
ch.setFormatter(fmt)
if not logger.handlers:
    logger.addHandler(fh)
    logger.addHandler(ch)

@app.get("/ping")
def ping():
    logger.info("ping")
    return {"status": "ok"}

@app.get("/work/{n}")
def work(n: int):
    t = random.uniform(0.05, 0.8)
    time.sleep(t)
    if random.random() < 0.2:
        logger.error("random error in work()")
        raise HTTPException(status_code=500, detail="boom")
    logger.info(f"work({n}) took {t:.3f}s")
    return {"n": n, "t": t}