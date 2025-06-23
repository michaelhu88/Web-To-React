const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const downloadExternalCSS = require("./downloadExternalCSS");
const { extractFonts } = require("./extractFonts");
const { extractImages } = require("./extractImages");

/**
 * Fix all font paths in CSS content to use the flat fonts directory
 * This handles all possible path patterns to ensure fonts are found
 * @param {string} cssContent - The CSS content to fix
 * @param {string} flatFontsDirName - Name of the flat fonts directory
 * @returns {string} - The fixed CSS content
 */
function fixFontPaths(cssContent, flatFontsDirName) {
  // Handle front/assets/fonts paths
  cssContent = cssContent.replace(/url\(['"]?(\/front\/assets\/fonts\/[^'")\s]+)['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('../${flatFontsDirName}/${fontFile}')`;
    });
  
  // Handle /s/ paths (Google Fonts)
  cssContent = cssContent.replace(/url\(['"]?(\/s\/[^\/]+\/[^'")\s]+)['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('../${flatFontsDirName}/${fontFile}')`;
    });
  
  // Handle ajax/libs paths (KaTeX)
  cssContent = cssContent.replace(/url\(['"]?(\/ajax\/libs\/[^'")\s]+)['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('../${flatFontsDirName}/${fontFile}')`;
    });
  
  // Generic catch-all for any absolute paths to font files
  cssContent = cssContent.replace(/url\(['"]?(\/[^'")\s]+\.(woff2?|ttf|eot|otf|svg))['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('../${flatFontsDirName}/${fontFile}')`;
    });
  
  return cssContent;
}

/**
 * Check if a URL is for a resource that should be skipped
 * @param {string} url - URL to check
 * @returns {boolean} - True if the URL should be skipped
 */
function shouldSkipResource(url) {
  // We're now keeping all resources including KaTeX
  // This function is kept for future use if we need to skip specific resources
  return false;
}

/**
 * Extracts all CSS styles from a website including those loaded by JavaScript
 * using Puppeteer to render the page fully. Saves:
 * 1. Inline styles to App.css
 * 2. Computed styles from all elements to computed.css
 * 3. Downloads and saves external CSS files
 * 4. Extracts and downloads fonts from CSS files
 * 5. Extracts and downloads images from HTML and CSS
 *
 * @param {string} url - URL of the website to extract styles from
 * @param {string} outputDir - Output directory for saving CSS files
 * @returns {Promise<Object>} - Object containing style information
 */
async function extractStylesWithPuppeteer(url, outputDir = path.resolve(__dirname, "../../output/public")) {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  try {
    // Create output directory
    fs.mkdirSync(outputDir, { recursive: true });
    
    // Navigate to the URL and wait until network is idle
    await page.goto(url, { waitUntil: "networkidle0" });
    
    // Get the fully rendered HTML
    const renderedHTML = await page.content();
    
    // 1. Extract inline style blocks
    const inlineStyles = await page.evaluate(() => {
      const styleElements = document.querySelectorAll("style");
      return Array.from(styleElements).map(style => style.textContent).join("\n\n");
    });
    
    if (inlineStyles.trim()) {
      fs.writeFileSync(path.join(outputDir, "App.css"), inlineStyles);
      console.log("✅ Saved inline <style> blocks to App.css");
    }
    
    // 2. Extract computed styles from all elements
    const computedStyles = await page.evaluate(() => {
      const allElements = document.querySelectorAll("*");
      let uniqueStyles = new Map();
      
      Array.from(allElements).forEach(element => {
        try {
          const computedStyle = window.getComputedStyle(element);
          
          // Safely handle className which might not be a string
          let classSelector = "";
          if (element.className) {
            // Handle different className types
            if (typeof element.className === 'string') {
              classSelector = element.className.trim() ? 
                `.${element.className.trim().replace(/\s+/g, ".")}` : "";
            } else if (element.className.baseVal) {
              // Handle SVG elements that have className.baseVal
              classSelector = element.className.baseVal.trim() ? 
                `.${element.className.baseVal.trim().replace(/\s+/g, ".")}` : "";
            }
          }
          
          const selector = element.tagName.toLowerCase() + 
            (element.id ? `#${element.id}` : "") + 
            classSelector;
          
          if (!uniqueStyles.has(selector)) {
            let rules = [];
            for (let i = 0; i < computedStyle.length; i++) {
              const prop = computedStyle[i];
              const value = computedStyle.getPropertyValue(prop);
              if (value && value !== "initial" && value !== "auto") {
                rules.push(`${prop}: ${value};`);
              }
            }
            
            if (rules.length > 0) {
              uniqueStyles.set(selector, rules.join("\n  "));
            }
          }
        } catch (err) {
          // Skip elements that cause errors
          console.error(`Error processing element: ${err.message}`);
        }
      });
      
      let result = "";
      uniqueStyles.forEach((rules, selector) => {
        result += `${selector} {\n  ${rules}\n}\n\n`;
      });
      
      return result;
    });
    
    if (computedStyles.trim()) {
      fs.writeFileSync(path.join(outputDir, "computed.css"), computedStyles);
      console.log("✅ Saved computed styles to computed.css");
    }
    
    // 3. Extract external stylesheet URLs
    const externalStylesheets = await page.evaluate(() => {
      const linkElements = document.querySelectorAll('link[rel="stylesheet"]');
      return Array.from(linkElements).map(link => {
        return {
          href: link.href,
          id: link.id || '',
          media: link.media || 'all'
        };
      });
    });
    
    console.log(`📋 Found ${externalStylesheets.length} external stylesheets`);
    
    // Filter out unwanted resources like KaTeX
    const filteredStylesheets = externalStylesheets.filter(
      stylesheet => !shouldSkipResource(stylesheet.href)
    );
    
    console.log(`📋 After filtering, keeping ${filteredStylesheets.length} stylesheets`);
    if (filteredStylesheets.length < externalStylesheets.length) {
      console.log(`⏭️ Skipping ${externalStylesheets.length - filteredStylesheets.length} stylesheets (KaTeX, etc.)`);
    }
    
    // 4. Download external stylesheets
    const cssFiles = [];
    
    if (filteredStylesheets.length > 0) {
      console.log(`📥 Downloading ${filteredStylesheets.length} external stylesheets...`);
      
      for (const stylesheet of filteredStylesheets) {
        try {
          // Resolve full URL (handles relative hrefs like /style.css)
          const fullUrl = new URL(stylesheet.href, url).href;

          // Use filename from URL path (ignoring query params)
          const filename = path.basename(stylesheet.href.split('?')[0]) || `style-${cssFiles.length + 1}.css`;
          const filepath = path.join(outputDir, filename);
          
          // Skip if it's a KaTeX or other unwanted resource
          if (shouldSkipResource(fullUrl)) {
            console.log(`⏭️ Skipping unwanted resource: ${filename}`);
            continue;
          }

          const { data: cssContent } = await axios.get(fullUrl);
          fs.writeFileSync(filepath, cssContent);
          
          cssFiles.push({
            url: fullUrl,
            content: cssContent,
            filename,
            id: stylesheet.id,
            media: stylesheet.media
          });
          
          console.log(`✅ Downloaded and saved: ${filename}`);
        } catch (err) {
          console.warn(`⚠️ Failed to download ${stylesheet.href}: ${err.message}`);
        }
      }
    }
    
    // Add inline styles to the cssFiles array
    if (inlineStyles.trim()) {
      cssFiles.push({
        url: url,
        content: inlineStyles,
        filename: 'App.css',
        id: 'inline-styles',
        media: 'all'
      });
    }
    
    // 5. Extract fonts from CSS files
    console.log(`\n📦 Extracting fonts from CSS files...`);
    const { fontPaths, fontFaceCssPath } = await extractFonts(renderedHTML, cssFiles, url, outputDir);
    
    // Add font-faces.css to the cssFiles list if it was created
    if (fontFaceCssPath) {
      cssFiles.push({
        url: url,
        content: fs.readFileSync(path.join(outputDir, fontFaceCssPath), 'utf-8'),
        filename: fontFaceCssPath,
        id: 'font-faces',
        media: 'all'
      });
      console.log(`✅ Added ${fontFaceCssPath} to style imports`);
    }
    
    // 6. Extract images from HTML and CSS
    console.log(`\n🖼️ Extracting images from HTML and CSS...`);
    const { processedImages, updatedHtml } = await extractImages(renderedHTML, cssFiles, url, outputDir);
    
    // After everything else is done, process all CSS files to fix any remaining font path issues
    console.log(`\n🔧 Post-processing CSS files to fix font paths...`);
    try {
      const allCssFiles = fs.readdirSync(outputDir)
        .filter(file => file.endsWith('.css'));
        
      for (const cssFile of allCssFiles) {
        const cssPath = path.join(outputDir, cssFile);
        try {
          let cssContent = fs.readFileSync(cssPath, 'utf8');
          const updatedCss = fixFontPaths(cssContent, 'fonts-flat'); // Always use fonts-flat for consistency
          fs.writeFileSync(cssPath, updatedCss);
          console.log(`✅ Fixed font paths in ${cssFile}`);
        } catch (err) {
          console.warn(`⚠️ Could not fix font paths in ${cssFile}: ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`⚠️ Error during CSS post-processing: ${err.message}`);
    }
    
    console.log('\n🎉 Style extraction complete!');
    
    return {
      html: updatedHtml,
      cssFiles,
      fontPaths,
      imagesPaths: processedImages
    };
  } finally {
    await browser.close();
  }
}

// Run the function directly if called from command line
if (require.main === module) {
  const url = process.argv[2] || 'https://neatnik.net';
  // Use absolute path for output directory
  const outputDir = process.argv[3] || path.resolve(__dirname, "../../output/public");
  
  console.log(`🔍 Extracting styles from ${url} to ${outputDir}`);
  
  extractStylesWithPuppeteer(url, outputDir)
    .then(result => {
      console.log(`✨ Extracted ${result.cssFiles.length} CSS files, ${result.fontPaths?.length || 0} fonts, and ${result.imagesPaths?.length || 0} images`);
    })
    .catch(err => {
      console.error('❌ Error:', err);
      process.exit(1);
    });
}

module.exports = extractStylesWithPuppeteer; 