/**
* Process a single route/URL into a React component with global CSS strategy
*
* This module extracts HTML, styles, and images from a URL and converts it to a React component
* Uses a global CSS approach where all CSS is consolidated into one shared global.css file
* while maintaining page-specific asset directories
*/

const path = require('path');
const fs = require('fs');
const extractRenderedHTML = require('../extractors/extractHTMLWithPuppeteer');
const extractStylesWithPuppeteer = require('../extractors/extractStylesWithPuppeteer');
const { convertHTMLtoJSX, generateCSSFromVars, cssVarMap, getImageImports, setSanitizedFilenameMap } = require('../converters/convertHTMLtoJSX');
const { extractImages } = require('../extractors/extractImages');
const { extractFonts } = require('../extractors/extractFonts');

// Global CSS accumulator - shared across all route processing
let globalCssContent = '';
let globalCssVars = {};

/**
 * Fix all asset paths in CSS content for global CSS strategy
 * Since assets are in page-specific directories, we need to handle paths differently
 * @param {string} cssContent - The CSS content to fix
 * @param {string} componentName - Name of the component (for page-specific asset paths)
 * @returns {string} - The fixed CSS content
 */
function fixAssetPathsForGlobal(cssContent, componentName) {
  // For global CSS, we need to reference page-specific asset directories
  // Pattern: url('../pages/ComponentName/images-flat/filename.ext')
  
  // Fix local relative paths first (./fonts-flat/ and ./images-flat/)
  cssContent = cssContent.replace(/url\(['"]?\.\/fonts-flat\/([^'")\s]+)['"]?\)/gi, 
    (match, fontFile) => {
      return `url('../pages/${componentName}/fonts-flat/${fontFile}')`;
    });
  
  cssContent = cssContent.replace(/url\(['"]?\.\/images-flat\/([^'")\s]+)['"]?\)/gi, 
    (match, imageFile) => {
      return `url('../pages/${componentName}/images-flat/${imageFile}')`;
    });
  
  // Fix font paths - point to page-specific fonts-flat directories
  cssContent = cssContent.replace(/url\(['"]?(\/front\/assets\/fonts\/[^'")\s]+)['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('../pages/${componentName}/fonts-flat/${fontFile}')`;
    });
  
  cssContent = cssContent.replace(/url\(['"]?(\/s\/[^\/]+\/[^'")\s]+)['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('../pages/${componentName}/fonts-flat/${fontFile}')`;
    });
  
  cssContent = cssContent.replace(/url\(['"]?(\/ajax\/libs\/[^'")\s]+)['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('../pages/${componentName}/fonts-flat/${fontFile}')`;
    });
  
  cssContent = cssContent.replace(/url\(['"]?(\/[^'")\s]+\.(woff2?|ttf|eot|otf))['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('../pages/${componentName}/fonts-flat/${fontFile}')`;
    });
  
  // Fix image paths - point to page-specific images-flat directories
  cssContent = cssContent.replace(/url\(['"]?\.\.\/images-flat\/([^'")\s]+)['"]?\)/gi, 
    (match, imagePath) => {
      return `url('../pages/${componentName}/images-flat/${imagePath}')`;
    });
  
  cssContent = cssContent.replace(/url\(['"]?(\/[^'")\s]+\.(png|jpg|jpeg|gif|webp|svg))['"]?\)/gi, 
    (match, imagePath) => {
      const imageFile = path.basename(imagePath);
      return `url('../pages/${componentName}/images-flat/${imageFile}')`;
    });
  
  cssContent = cssContent.replace(/url\(['"]?(?:\.\.\/)*images\/([^'")\s]+)['"]?\)/gi, 
    (match, imagePath) => {
      return `url('../pages/${componentName}/images-flat/${imagePath}')`;
    });
  
  cssContent = cssContent.replace(/url\(['"]?([^'")\s\/]+\.(png|jpg|jpeg|gif|webp))['"]?\)/gi, 
    (match, imageFile) => {
      return `url('../pages/${componentName}/images-flat/${imageFile}')`;
    });
  
  return cssContent;
}

/**
 * Add CSS content to the global CSS accumulator
 * @param {string} cssContent - CSS content to add
 * @param {string} componentName - Component name for asset path fixing
 * @param {string} source - Source identifier for the CSS (e.g., 'inline', 'external', 'font-faces')
 */
function accumulateCSS(cssContent, componentName, source = 'unknown') {
  if (!cssContent || cssContent.trim() === '') return;
  
  // Fix asset paths for global CSS
  const fixedCss = fixAssetPathsForGlobal(cssContent, componentName);
  
  // Add a comment to identify the source
  const cssWithComment = `\n/* === CSS from ${componentName} (${source}) === */\n${fixedCss}\n`;
  
  globalCssContent += cssWithComment;
  console.log(`📝 Accumulated CSS from ${componentName} (${source})`);
}

/**
 * Write the accumulated global CSS to file
 * @param {string} outputDir - Base output directory
 */
function writeGlobalCSS(outputDir) {
  const sharedDir = path.join(outputDir, 'src/shared');
  fs.mkdirSync(sharedDir, { recursive: true });
  
  // Add global CSS variables if any
  if (Object.keys(globalCssVars).length > 0) {
    const customVarsCss = generateCSSFromVars(globalCssVars);
    globalCssContent += '\n/* === Global CSS Variables === */\n' + customVarsCss + '\n';
  }
  
  const globalCssPath = path.join(sharedDir, 'global.css');
  fs.writeFileSync(globalCssPath, globalCssContent);
  console.log(`✅ Global CSS written to: ${globalCssPath} (${globalCssContent.length} characters)`);
  
  return globalCssPath;
}

/**
 * Reset global CSS accumulator (for new processing sessions)
 */
function resetGlobalCSS() {
  globalCssContent = '';
  globalCssVars = {};
  console.log('🔄 Reset global CSS accumulator');
}

/**
* Process a single route into a React component using global CSS strategy
*
* @param {string} url - The URL of the route to process
* @param {string} componentName - The name for the component
* @param {boolean} isDeprecated - Unused parameter, kept for backward compatibility
* @param {boolean} isMultiPage - Whether this is part of a multi-page site
* @param {string} outputDir - Base output directory
* @returns {Object} The processed component information
*/
async function processRoute(url, componentName, isDeprecated = false, isMultiPage = false, outputDir = path.resolve(process.cwd(), 'output')) {
  // Create directory paths - keep page-specific asset directories
  const htmlDir = path.join(outputDir, 'html');
  const stylesDir = path.join(outputDir, `src/pages/${componentName}`);
  const pagesDir = path.join(outputDir, 'src/pages');
  
  console.log(`\n🔄 Processing route (Global CSS): ${url} => ${componentName}`);
  
  try {
    // Ensure directories exist
    fs.mkdirSync(htmlDir, { recursive: true });
    fs.mkdirSync(stylesDir, { recursive: true });
    fs.mkdirSync(pagesDir, { recursive: true });
   
    // 1. Extract HTML
    const htmlOutputPath = path.join(htmlDir, `${componentName}.html`);
    console.log(`📄 Extracting HTML for ${componentName}...`);
    const renderedHTML = await extractRenderedHTML(url, htmlOutputPath);
   
    // 2. Extract CSS - do this for every page to capture page-specific styles
    console.log(`🎨 Extracting CSS styles...`);
    const extractedStyles = await extractStylesWithPuppeteer(url, stylesDir);
   
    // 3. Extract fonts from CSS files
    console.log(`📦 Extracting fonts for ${componentName}...`);
    const { fontPaths, fontFaceCssPath } = await extractFonts(renderedHTML, extractedStyles.cssFiles, url, stylesDir);
    
    // 4. Extract and download images - keep in page-specific directories
    console.log(`🖼️ Processing images for ${componentName}...`);
    const { processedImages, updatedHtml, imageMap } = await extractImages(
      renderedHTML,
      extractedStyles.cssFiles,
      url,
      stylesDir
    );
   
    // Pass the sanitized filename mapping to the JSX converter
    setSanitizedFilenameMap(imageMap);
   
    // 5. Convert to JSX
    const jsxOutputPath = path.join(pagesDir, `${componentName}.jsx`);
    console.log(`⚛️ Converting HTML to JSX for ${componentName}...`);
    const jsxContent = convertHTMLtoJSX(updatedHtml || renderedHTML);
   
    // Get image imports (these will still be page-specific)
    const imageImports = getImageImports();
   
    // 6. GLOBAL CSS STRATEGY: Accumulate CSS instead of creating individual files
    
    // Accumulate external CSS files
    if (extractedStyles.cssFiles && extractedStyles.cssFiles.length > 0) {
      for (const cssFile of extractedStyles.cssFiles) {
        if (cssFile.content) {
          accumulateCSS(cssFile.content, componentName, `external-${cssFile.id || cssFile.filename || 'unknown'}`);
        }
      }
    }
    
    // Accumulate inline styles (App.css equivalent)
    const appCssPath = path.join(stylesDir, "App.css");
    if (fs.existsSync(appCssPath)) {
      const inlineCSS = fs.readFileSync(appCssPath, 'utf8');
      accumulateCSS(inlineCSS, componentName, 'inline-styles');
      // Remove the individual file since we're using global CSS
      fs.unlinkSync(appCssPath);
    }
    
    // Accumulate component-specific styles (style.css)
    const styleFilePath = path.join(stylesDir, "style.css");
    if (fs.existsSync(styleFilePath)) {
      const componentCSS = fs.readFileSync(styleFilePath, 'utf8');
      accumulateCSS(componentCSS, componentName, 'component-styles');
      // Remove the individual file since we're using global CSS
      fs.unlinkSync(styleFilePath);
    }
    
    // Accumulate font-face CSS
    if (fontFaceCssPath) {
      const fontFaceCssFullPath = path.join(stylesDir, fontFaceCssPath);
      if (fs.existsSync(fontFaceCssFullPath)) {
        const fontCSS = fs.readFileSync(fontFaceCssFullPath, 'utf8');
        accumulateCSS(fontCSS, componentName, 'font-faces');
        // Remove the individual file since we're using global CSS
        fs.unlinkSync(fontFaceCssFullPath);
      }
    }
    
    // Accumulate CSS variables
    if (Object.keys(cssVarMap).length > 0) {
      // Merge with global CSS variables
      globalCssVars = { ...globalCssVars, ...cssVarMap };
      console.log(`✅ Added ${Object.keys(cssVarMap).length} CSS variables from ${componentName} to global vars`);
    }
   
    // Add navigation imports for multi-page sites
    const addNavigationImport = isMultiPage;
   
    // Create the final component code - import global CSS instead of individual files
    const componentCode = `
import React from 'react';
${addNavigationImport ? "import { Link } from 'react-router-dom';\n" : ""}${imageImports ? imageImports + '\n' : ''}import '../../shared/global.css';


export default function ${componentName}() {
  return (
    <React.Fragment>
${jsxContent}${addNavigationImport && componentName !== 'Home' ? '\n      <div className="navigation-links" style={{ margin: "20px 0", padding: "10px" }}>\n        <Link to="/" style={{ color: "#0066cc", textDecoration: "none" }}>← Back to Home</Link>\n      </div>' : ''}
    </React.Fragment>
  );
}
`;
   
    // Write the component file
    fs.writeFileSync(jsxOutputPath, componentCode);
    console.log(`✅ React component for ${componentName} saved to: ${jsxOutputPath}`);
   
    // Log image info
    if (imageImports) {
      const imageImportCount = imageImports.split('\n').length;
      console.log(`✅ Added ${imageImportCount} image import${imageImportCount !== 1 ? 's' : ''}`);
    }
   
    return {
      componentName,
      componentPath: jsxOutputPath,
      htmlPath: htmlOutputPath,
      url,
      imagesProcessed: processedImages?.length || 0,
      fontsProcessed: fontPaths?.length || 0,
      cssStrategy: 'global'
    };
   
  } catch (error) {
    console.error(`❌ Error processing route ${url}: ${error.message}`);
    throw error;
  }
}

module.exports = {
  processRoute,
  writeGlobalCSS,
  resetGlobalCSS,
  accumulateCSS
};