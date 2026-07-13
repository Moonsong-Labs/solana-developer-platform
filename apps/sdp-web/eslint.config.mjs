import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // sdp-web must not import the SPC engine transport package directly: reach SPC
  // through sdp-api (lib/sdp-api + the lib/private-channels wrapper), and import
  // wire types/constants from @sdp/types. Keeps the common API layer at sdp-api.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@sdp/private-channels", "@sdp/private-channels/*"],
              message:
                "Do not import @sdp/private-channels in sdp-web. Call sdp-api via lib/sdp-api (+ the typed lib/private-channels wrapper); import wire types/constants from @sdp/types.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
