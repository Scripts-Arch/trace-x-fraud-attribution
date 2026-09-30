/** Environment-driven configuration. */
const rawPort = Number(process.env.PORT);

export const env = {
  port: Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 4000,
  jwtSecret: process.env.JWT_SECRET || "trace-x-demo-secret-change-in-production",
  mlServiceUrl: process.env.ML_SERVICE_URL || "http://localhost:8000",
  ncrpMode: process.env.NCRP_MODE || "sandbox",
  sahyogMode: process.env.SAHYOG_MODE || "sandbox",
  dbFile: process.env.TRACE_X_DB || "data/tracex.db",
  // CORS: comma-separated list of allowed origins for the web console.
  // "*" (default) is fine for the sandbox demo; set it in production.
  corsOrigin: (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim()),
  // When set to a built web bundle (apps/web/dist), the API serves the
  // console itself — enables single-service deployment on one URL.
  webDist: process.env.WEB_DIST || "",
};
