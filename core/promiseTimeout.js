/**
 * Race a promise against a timeout; rejects with an Error whose name is TimeoutError on expiry.
 */
function withTimeout(promise, ms, label = "operation") {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return promise;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const err = new Error(`${label} timed out after ${n}ms`);
      err.name = "TimeoutError";
      err.code = "ETIMEDOUT";
      reject(err);
    }, n);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

module.exports = { withTimeout };
