const axios = require("axios");
const fs = require("fs");
const path = require("path");

/**
 * Downloads a CSS file given its href, resolves full URL,
 * and saves it into the given output directory.
 * Also parses the CSS for font references and downloads them.
 *
 * @param {string} href - The href from <link rel="stylesheet" href="...">
 * @param {string} baseUrl - The base URL of the original site (e.g. https://example.com)
 * @param {string} outputDir - Folder to save the CSS file (e.g. output/public)
 */
async function downloadExternalCSS(href, baseUrl, outputDir) {
  try {
    // Resolve full URL (handles relative hrefs like /style.css)
    const fullUrl = new URL(href, baseUrl).href;

    // Use filename from URL path (ignoring query params)
    const filename = path.basename(href.split('?')[0]) || "style.css";
    const filepath = path.join(outputDir, filename);

    const { data: cssContent } = await axios.get(fullUrl);

    // Create output directory
    fs.mkdirSync(outputDir, { recursive: true });
    
    // Download any font files referenced in the CSS
    const fontUrls = extractFontUrls(cssContent);
    if (fontUrls.length > 0) {
      // Create fonts directory
      const fontsDir = path.join(outputDir, 'fonts');
      fs.mkdirSync(fontsDir, { recursive: true });
      
      console.log(`📦 Found ${fontUrls.length} font files in ${filename}`);
      
      await Promise.all(fontUrls.map(async fontUrl => {
        try {
          // Resolve full font URL
          const fullFontUrl = new URL(fontUrl, fullUrl).href;
          const fontFilename = path.basename(fontUrl.split('?')[0]);
          const fontFilepath = path.join(fontsDir, fontFilename);
          
          // Download font file
          const response = await axios({
            method: 'get',
            url: fullFontUrl,
            responseType: 'arraybuffer'
          });
          
          fs.writeFileSync(fontFilepath, response.data);
          console.log(`✅ Downloaded font: ${fontFilename}`);
        } catch (fontErr) {
          console.warn(`⚠️ Failed to download font ${fontUrl}: ${fontErr.message}`);
        }
      }));
    }

    // Save the CSS file
    fs.writeFileSync(filepath, cssContent);
    console.log(`✅ Downloaded and saved: ${filename}`);
  } catch (err) {
    console.warn(`⚠️ Failed to download ${href}: ${err.message}`);
  }
}

/**
 * Extracts font URLs from CSS content
 * @param {string} cssContent - CSS content to parse
 * @returns {string[]} - Array of font URLs
 */
function extractFontUrls(cssContent) {
  const fontUrlRegex = /url\(['"]?([^'"\)]+\.(?:woff2?|ttf|eot|otf))['"]?\)/gi;
  const fontUrls = [];
  let match;
  
  while (match = fontUrlRegex.exec(cssContent)) {
    fontUrls.push(match[1]);
  }
  
  return fontUrls;
}

module.exports = downloadExternalCSS;
