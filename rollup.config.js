import terser from "@rollup/plugin-terser";
import copy from "rollup-plugin-copy";

const input = "src/float-imgplay.js";
const name = "FloatImgPlay";

export default [
  // ESM build
  {
    input,
    output: {
      file: "dist/float-imgplay.esm.js",
      format: "es"
    }
  },
  // UMD build
  {
    input,
    output: {
      file: "dist/float-imgplay.umd.js",
      format: "umd",
      name,
      exports: "named"
    }
  },
  // IIFE build (unminified)
  {
    input,
    output: {
      file: "dist/float-imgplay.iife.js",
      format: "iife",
      name,
      exports: "named"
    }
  },
  // IIFE build (minified) + copy CSS
  {
    input,
    output: {
      file: "dist/float-imgplay.iife.min.js",
      format: "iife",
      name,
      exports: "named"
    },
    plugins: [
      terser(),
      copy({
        targets: [
          { src: "src/float-imgplay.css", dest: "dist/" }
        ]
      })
    ]
  }
];
