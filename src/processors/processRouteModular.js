/**
* Process a single route/URL into a React component
*
* This module extracts HTML, styles, and images from a URL and converts it to a React component
* Directly mirrors the extraction logic from html-to-react.js
*/


const path = require('path');
const fs = require('fs');
const extractRenderedHTML = require('../extractors/extractHTMLWithPuppeteer');
const extractStylesWithPuppeteer = require('../extractors/extractStylesWithPuppeteer');
const { convertHTMLtoJSX, generateCSSFromVars, cssVarMap, getImageImports, setSanitizedFilenameMap } = require('../converters/convertHTMLtoJSX');
const { extractImages } = require('../extractors/extractImages');
const { extractFonts } = require('../extractors/extractFonts');

/**
 * Fix all asset paths in CSS content to use the correct flat directories
 * @param {string} cssContent - The CSS content to fix
 * @param {string} flatFontsDirName - Name of the flat fonts directory
 * @param {string} flatImagesDirName - Name of the flat images directory
 * @returns {string} - The fixed CSS content
 */
function fixAssetPaths(cssContent, flatFontsDirName = 'fonts-flat', flatImagesDirName = 'images-flat') {
  // Fix font paths
  
  // Handle front/assets/fonts paths
  cssContent = cssContent.replace(/url\(['"]?(\/front\/assets\/fonts\/[^'")\s]+)['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('./${flatFontsDirName}/${fontFile}')`;
    });
  
  // Handle /s/ paths (Google Fonts)
  cssContent = cssContent.replace(/url\(['"]?(\/s\/[^\/]+\/[^'")\s]+)['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('./${flatFontsDirName}/${fontFile}')`;
    });
  
  // Handle ajax/libs paths (KaTeX)
  cssContent = cssContent.replace(/url\(['"]?(\/ajax\/libs\/[^'")\s]+)['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('./${flatFontsDirName}/${fontFile}')`;
    });
  
  // Generic catch-all for any absolute paths to font files
  cssContent = cssContent.replace(/url\(['"]?(\/[^'")\s]+\.(woff2?|ttf|eot|otf|svg))['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('./${flatFontsDirName}/${fontFile}')`;
    });
  
  // Fix image paths
  
  // Fix any ../images-flat/ paths to ./images-flat/
  cssContent = cssContent.replace(/url\(['"]?\.\.\/images-flat\/([^'")\s]+)['"]?\)/gi, 
    (match, imagePath) => {
      return `url('./${flatImagesDirName}/${imagePath}')`;
    });
  
  // Fix any absolute image paths to use images-flat
  cssContent = cssContent.replace(/url\(['"]?(\/[^'")\s]+\.(png|jpg|jpeg|gif|webp|svg))['"]?\)/gi, 
    (match, imagePath) => {
      const imageFile = path.basename(imagePath);
      return `url('./${flatImagesDirName}/${imageFile}')`;
    });
  
  // Fix any relative image paths that might be wrong
  cssContent = cssContent.replace(/url\(['"]?(?:\.\.\/)*images\/([^'")\s]+)['"]?\)/gi, 
    (match, imagePath) => {
      return `url('./${flatImagesDirName}/${imagePath}')`;
    });
  
  // Fix any direct image references without directory (might be in wrong location)
  cssContent = cssContent.replace(/url\(['"]?([^'")\s\/]+\.(png|jpg|jpeg|gif|webp))['"]?\)/gi, 
    (match, imageFile) => {
      return `url('./${flatImagesDirName}/${imageFile}')`;
    });
  
  return cssContent;
}


/**
* Process a single route into a React component
*
* @param {string} url - The URL of the route to process
* @param {string} componentName - The name for the component
* @param {boolean} isDeprecated - Unused parameter, kept for backward compatibility
* @param {boolean} isMultiPage - Whether this is part of a multi-page site
* @param {string} outputDir - Base output directory
* @returns {Object} The processed component information
*/
async function processRoute(url, componentName, isDeprecated = false, isMultiPage = false, outputDir = path.resolve(process.cwd(), 'output')) {
 // Create directory paths
 const htmlDir = path.join(outputDir, 'html');
 const stylesDir = path.join(outputDir, `src/pages/${componentName}`);
 const pagesDir = path.join(outputDir, 'src/pages');
  console.log(`\n🔄 Processing route: ${url} => ${componentName}`);
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
   
   // Add font-faces.css to the cssFiles list if it was created
   if (fontFaceCssPath) {
     extractedStyles.cssFiles.push({
       url: url,
       content: fs.readFileSync(path.join(stylesDir, fontFaceCssPath), 'utf-8'),
       filename: fontFaceCssPath,
       id: 'font-faces',
       media: 'all'
     });
     console.log(`✅ Added ${fontFaceCssPath} to style imports for ${componentName}`);
   }
  
   // 4. Extract and download images
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
  
   // Get image imports
   const imageImports = getImageImports();
  
   // 6. Create style imports - only import the 4 required CSS files
   const styleImports = [];
   
   // Rename style.css to componentName.css to avoid naming conflicts in multi-page sites
   const styleFilePath = path.join(stylesDir, "style.css");
   const componentStylePath = path.join(stylesDir, `${componentName}.css`);
   if (fs.existsSync(styleFilePath)) {
     console.log(`🔄 Renaming style.css to ${componentName}.css for route-specific styling`);
     fs.renameSync(styleFilePath, componentStylePath);
   }

   // Add exactly 4 CSS imports in order (only if files exist):
   // 1. font-faces.css
   const fontFacesCssPath = path.join(stylesDir, "font-faces.css");
   if (fs.existsSync(fontFacesCssPath)) {
     styleImports.push(`import './font-faces.css';`);
   }
  
   // 2. App.css (inline styles)
   const appCssPath = path.join(stylesDir, "App.css");
   if (fs.existsSync(appCssPath)) {
     styleImports.push(`import './App.css';`);
   }
   
   // 3. Component-specific CSS file
   if (fs.existsSync(componentStylePath)) {
     styleImports.push(`import './${componentName}.css';`);
   }
   
   // 4. custom-vars.css (will be added later if CSS variables exist)
  
   // Generate CSS for custom variables if needed
   if (Object.keys(cssVarMap).length > 0) {
     const customVarsCss = generateCSSFromVars(cssVarMap);
     const customCssPath = path.join(stylesDir, "custom-vars.css");
     fs.writeFileSync(customCssPath, customVarsCss);
     styleImports.push(`import './custom-vars.css';`);
     console.log(`✅ Added custom CSS variables for ${componentName}`);
   }
  
   // Add navigation imports for multi-page sites
   const addNavigationImport = isMultiPage;
  
   // Create the final component code
   const componentCode = `
import React from 'react';
${addNavigationImport ? "import { Link } from 'react-router-dom';\n" : ""}${imageImports ? imageImports + '\n' : ''}${styleImports.join('\n')}


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
  
   // Post-process all CSS files in this route's directory to fix asset paths
   console.log(`🔧 Post-processing CSS files for ${componentName} to fix asset paths...`);
   try {
     const allCssFiles = fs.readdirSync(stylesDir)
       .filter(file => file.endsWith('.css'));
       
     for (const cssFile of allCssFiles) {
       const cssPath = path.join(stylesDir, cssFile);
       try {
         let cssContent = fs.readFileSync(cssPath, 'utf8');
         const updatedCss = fixAssetPaths(cssContent, 'fonts-flat', 'images-flat');
         fs.writeFileSync(cssPath, updatedCss);
         console.log(`✅ Fixed asset paths in ${cssFile} for ${componentName}`);
       } catch (err) {
         console.warn(`⚠️ Could not fix asset paths in ${cssFile}: ${err.message}`);
       }
     }
   } catch (err) {
     console.warn(`⚠️ Error during CSS post-processing for ${componentName}: ${err.message}`);
   }
  
   return {
     componentName,
     componentPath: jsxOutputPath,
     htmlPath: htmlOutputPath,
     url,
     imagesProcessed: processedImages?.length || 0,
     fontsProcessed: fontPaths?.length || 0
   };
  
 } catch (error) {
   console.error(`❌ Error processing route ${url}: ${error.message}`);
   throw error;
 }
}


module.exports = processRoute;

