/**
 * Release gate for map0-check: verify the PACKED TARBALL, never packages/check/dist.
 *
 * The tarball is installed with npm into a scratch project — the way a user gets
 * it, so ogc-client has to resolve from that node_modules, not from the workspace —
 * and the installed bin is run three times: `--version` must print the tarball's
 * own version, `--help` must exit 0, and a probe against a WMS served from this
 * process must come back "ready for map0" with a schema-valid layer definition.
 * The last run is the one that matters: detection, the dynamic ogc-client import
 * from inside the bundle, core's capabilities reading, the GetMap probe and the
 * schema validator, all without touching the network.
 *
 * Usage: node e2e/verify-check-tarball.mjs <path-to-tgz>
 */
import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const tarball = resolve(process.cwd(), process.argv[2] ?? "");
if (!process.argv[2] || !existsSync(tarball)) {
  console.error(`usage: verify-check-tarball.mjs <path-to-tgz> — got "${process.argv[2] ?? ""}"`);
  process.exit(1);
}
const shell = process.platform === "win32";

/* ------------------------------------------------ the tarball's own version */

/* relative paths only: a drive-letter argument makes GNU tar (MSYS) read "C:"
   as a remote host ("Cannot connect to C") */
const packed = spawnSync("tar", ["-xzOf", basename(tarball), "package/package.json"], {
  cwd: dirname(tarball),
  encoding: "utf8",
});
if (packed.status !== 0 || !packed.stdout) {
  console.error(`✗ cannot read package/package.json from ${basename(tarball)}`);
  process.exit(1);
}
const { version, name } = JSON.parse(packed.stdout);
if (name !== "map0-check") {
  console.error(`✗ tarball is "${name}", not map0-check`);
  process.exit(1);
}

/* ------------------------------------------------------- fixture WMS server */

/* a 1×1 transparent PNG — the checker only looks at the content type */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const capabilities = (origin) => `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms" xmlns:xlink="http://www.w3.org/1999/xlink">
  <Service>
    <Name>WMS</Name>
    <Title>map0-check fixture</Title>
    <OnlineResource xlink:href="${origin}/wms"/>
  </Service>
  <Capability>
    <Request>
      <GetCapabilities>
        <Format>text/xml</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:href="${origin}/wms?"/></Get></HTTP></DCPType>
      </GetCapabilities>
      <GetMap>
        <Format>image/png</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:href="${origin}/wms?"/></Get></HTTP></DCPType>
      </GetMap>
      <GetFeatureInfo>
        <Format>application/json</Format>
        <DCPType><HTTP><Get><OnlineResource xlink:href="${origin}/wms?"/></Get></HTTP></DCPType>
      </GetFeatureInfo>
    </Request>
    <Exception><Format>XML</Format></Exception>
    <Layer>
      <Title>root — CRS declared here only, as GeoServer does</Title>
      <CRS>EPSG:4326</CRS>
      <CRS>EPSG:3857</CRS>
      <Layer queryable="1">
        <Name>fixture</Name>
        <Title>Fixture layer</Title>
        <CRS>CRS:84</CRS>
        <EX_GeographicBoundingBox>
          <westBoundLongitude>16.1</westBoundLongitude>
          <eastBoundLongitude>16.6</eastBoundLongitude>
          <southBoundLatitude>48.1</southBoundLatitude>
          <northBoundLatitude>48.4</northBoundLatitude>
        </EX_GeographicBoundingBox>
        <BoundingBox CRS="CRS:84" minx="16.1" miny="48.1" maxx="16.6" maxy="48.4"/>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>
`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const request = [...url.searchParams].find(([k]) => k.toLowerCase() === "request")?.[1]?.toLowerCase();
  const headers = { "Access-Control-Allow-Origin": "*" };
  if (url.pathname === "/wms" && request === "getcapabilities") {
    res.writeHead(200, { ...headers, "Content-Type": "text/xml" });
    res.end(capabilities(`http://127.0.0.1:${server.address().port}`));
  } else if (url.pathname === "/wms" && request === "getmap") {
    res.writeHead(200, { ...headers, "Content-Type": "image/png" });
    res.end(PNG);
  } else {
    res.writeHead(404, headers);
    res.end("not here");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;

/* ---------------------------------------------------- install into scratch */

const scratch = mkdtempSync(join(tmpdir(), "map0-check-"));
let failed = false;
const fail = (message) => {
  console.error(`✗ ${message}`);
  failed = true;
};

try {
  writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "scratch", private: true }));
  const install = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", tarball], {
    cwd: scratch,
    encoding: "utf8",
    shell,
  });
  if (install.status !== 0) {
    fail(`npm install of the tarball failed:\n${install.stderr || install.stdout}`);
  } else {
    console.log(`  installed ${basename(tarball)} into a scratch project`);
    const bin = join(scratch, "node_modules", "map0-check", "bin", "map0-check.js");
    /* asynchronous on purpose: a spawnSync here would block the event loop, and
       with it the fixture server the probe is about to call */
    const run = (...args) =>
      new Promise((done) => {
        execFile(
          process.execPath,
          [bin, ...args],
          { cwd: scratch, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
          (error, stdout, stderr) =>
            done({ status: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }),
        );
      });

    const v = await run("--version");
    if (v.status !== 0 || v.stdout.trim() !== version) {
      fail(`--version printed "${v.stdout.trim()}" (exit ${v.status}), tarball says ${version}`);
    } else {
      console.log(`  --version → ${version}`);
    }

    const h = await run("--help");
    if (h.status !== 0 || !h.stdout.includes("Usage: map0-check")) fail(`--help exited ${h.status}`);
    else console.log("  --help → ok");

    const probe = await run("--json", "--timeout", "10000", `${origin}/wms?service=WMS&request=GetCapabilities`);
    let report;
    try {
      report = JSON.parse(probe.stdout);
    } catch {
      fail(`the probe did not print JSON (exit ${probe.status}):\n${probe.stdout}\n${probe.stderr}`);
    }
    if (report && !report.service) {
      fail(`the probe failed: ${report.error}${report.attempts ? ` (tried ${report.attempts.join(", ")})` : ""}`);
      report = undefined;
    }
    if (report) {
      const layer = report.service?.layers?.[0];
      const schema = report.service?.findings?.find((f) => f.code === "schema");
      const getmap = layer?.findings?.find((f) => f.code === "getmap");
      const checks = [
        [probe.status === 0, `exit code ${probe.status}, expected 0`],
        [report.service?.kind === "wms", `detected "${report.service?.kind}", expected wms`],
        [report.verdict === "ok", `verdict "${report.verdict}", expected ok`],
        [layer?.probed === true && getmap?.level === "ok", `GetMap probe: ${getmap?.message ?? "missing"}`],
        [layer?.snippet?.type === "wms" && layer?.snippet?.layers === "fixture", `snippet: ${JSON.stringify(layer?.snippet)}`],
        [schema?.level === "ok", `schema finding: ${schema?.message ?? "missing"}`],
      ];
      for (const [ok, message] of checks) if (!ok) fail(`fixture WMS: ${message}`);
      if (!checks.some(([ok]) => !ok)) console.log("  fixture WMS → ready for map0, GetMap probed, snippet validates");
    }
  }
} finally {
  server.close();
  rmSync(scratch, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log(`✓ ${basename(tarball)} verified`);
