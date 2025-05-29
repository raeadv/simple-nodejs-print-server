// esbuild-bundle.js
require("esbuild")
  .build({
    entryPoints: ["index.js"],
    bundle: true,
    platform: "node",
    format: "cjs", // Important for SEA
    outfile: "printserver.build.js",
  })
  .catch(() => process.exit(1));
