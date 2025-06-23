const fs = require("fs");
const path = require("path");
const extractStylesFromDOM = require("./extractStylesFromDOM");
const downloadExternalCSS = require("../src/extractors/downloadExternalCSS");

// Simulate test input
const html = fs.readFileSync("test-site.html", "utf-8"); // replace with any HTML file
const baseUrl = "https://neatnik.net"; // change to real URL if testing real site
const outputDir = "output/public";

// Extract styles
const cssHrefs = extractStylesFromDOM(html, outputDir);
console.log(cssHrefs);

// Download external CSS
(async () => {
  for (const href of cssHrefs) {
    await downloadExternalCSS(href, baseUrl, outputDir);
  }
})();
