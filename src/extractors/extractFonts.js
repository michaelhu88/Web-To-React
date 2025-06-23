const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Check if a font URL is from Google Fonts
 * @param {string} url - The font URL to check
 * @returns {boolean} - True if the font is from Google Fonts
 */
function isGoogleFont(url) {
  // Check for common patterns in Google Font URLs
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    return true;
  }
  
  // Check for common Google Fonts patterns (like /s/sourcesanspro/)
  if (url.includes('/s/sourcesanspro/') || 
      url.includes('/s/ibmplexmono/') || 
      url.match(/\/v\d+\//)) {
    return true;
  }
  
  // Check for uuid-style font filenames which are often Google Fonts or static fonts
  if (url.match(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(woff2?|ttf)/i)) {
    return true;
  }
  
  // Additionally include front/assets/fonts pattern which appears to contain static fonts
  if (url.includes('/front/assets/fonts/')) {
    return true;
  }
  
  return false;
}

/**
 * Extracts font files from CSS content and downloads them
 * @param {string} cssContent - The CSS content to analyze
 * @param {string} baseUrl - Base URL of the website
 * @param {string} cssUrl - URL of the CSS file (for resolving relative paths)
 * @param {string} outputDir - Directory to save the font files
 * @returns {Promise<Array>} Array of downloaded font paths
 */
async function extractFontsFromCSS(cssContent, baseUrl, cssUrl, outputDir) {
  const fontPaths = [];
  // Create flat fonts directory directly - no structured hierarchy
  const flatFontsDir = path.join(outputDir, 'fonts-flat');
  fs.mkdirSync(flatFontsDir, { recursive: true });
  
  // 1. Find all font URLs in CSS using regex
  // Match @font-face blocks
  const fontFaceBlocks = cssContent.match(/@font-face\s*{[^}]*}/g) || [];
  
  // Match url() declarations from any property (not just in @font-face)
  const fontUrlRegex = /url\(['"]?([^'"\)]+\.(woff2?|ttf|eot|otf|svg))['"]?\)/gi;
  const fontUrls = new Set();
  let match;
  
  // Extract URLs from entire CSS
  while (match = fontUrlRegex.exec(cssContent)) {
    fontUrls.add(match[1]);
  }
  
  // Extract additional URLs from font-face blocks (might use different formats)
  fontFaceBlocks.forEach(block => {
    let fontMatch;
    while (fontMatch = fontUrlRegex.exec(block)) {
      fontUrls.add(fontMatch[1]);
    }
  });
  
  console.log(`📦 Found ${fontUrls.size} font files in CSS`);
  
  // Map to track original URL to font filename 
  const fontMapping = new Map();
  
  // 2. Download each font directly to the flat directory
  const downloadPromises = Array.from(fontUrls).map(async fontUrl => {
    try {
      // Resolve URL (handle relative/absolute paths)
      let fullFontUrl;
      if (fontUrl.startsWith('http')) {
        fullFontUrl = fontUrl;
      } else if (fontUrl.startsWith('/')) {
        // Absolute path from domain root
        fullFontUrl = new URL(fontUrl, baseUrl).href;
      } else {
        // Relative path from CSS file
        fullFontUrl = new URL(fontUrl, cssUrl).href;
      }
      
      // Extract just the filename without path structure
      const fontFilename = path.basename(new URL(fullFontUrl).pathname);
      const fontFilepath = path.join(flatFontsDir, fontFilename);
      
      // Download font file directly to fonts-flat
      const response = await axios({
        method: 'get',
        url: fullFontUrl,
        responseType: 'arraybuffer',
        // Handle redirects and don't fail on SSL errors
        maxRedirects: 5,
        validateStatus: status => status < 400,
        httpsAgent: new (require('https').Agent)({
          rejectUnauthorized: false
        })
      });
      
      fs.writeFileSync(fontFilepath, response.data);
      console.log(`✅ Downloaded font to flat directory: ${fontFilename}`);
      
      // Store mapping of original URL to flat filename
      fontMapping.set(fontUrl, fontFilename);
      
      // Add to list of downloaded fonts - path is always to fonts-flat
      fontPaths.push({
        originalUrl: fontUrl,
        localPath: `fonts-flat/${fontFilename}` // Simple flat path
      });
      
    } catch (fontErr) {
      console.warn(`⚠️ Failed to download font ${fontUrl}: ${fontErr.message}`);
    }
  });
  
  await Promise.allSettled(downloadPromises);
  
  // Log the mapping for debugging
  console.log(`📋 Font URL to filename mapping:`);
  fontMapping.forEach((filename, url) => {
    console.log(`  ${url} -> fonts-flat/${filename}`);
  });
  
  return fontPaths;
}

/**
 * Rewrite CSS to update font paths to local references
 * @param {string} cssContent - Original CSS content
 * @param {Array} fontPaths - Array of font paths {originalUrl, localPath}
 * @returns {string} - Rewritten CSS content
 */
function rewriteCSSFontPaths(cssContent, fontPaths) {
  let updatedCSS = cssContent;
  
  // Create a mapping of font base names to their available formats
  const fontFormatMap = new Map();
  fontPaths.forEach(({originalUrl, localPath}) => {
    const fontBaseName = path.basename(localPath).replace(/\.(woff2?|ttf|eot|otf|svg)$/i, '');
    const format = path.extname(localPath).toLowerCase();
    
    if (!fontFormatMap.has(fontBaseName)) {
      fontFormatMap.set(fontBaseName, []);
    }
    fontFormatMap.get(fontBaseName).push({format, path: localPath});
  });
  
  // First replace specific font paths from fontPaths
  fontPaths.forEach(({originalUrl, localPath}) => {
    // Escape special regex characters
    const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`url\\(['"]?${escapedUrl}['"]?\\)`, 'g');
    updatedCSS = updatedCSS.replace(regex, `url('../fonts-flat/${path.basename(localPath)}')`);
  });
  
  // Handle TTF references by replacing them with WOFF2/WOFF if available
  // First find all TTF references in the CSS
  const ttfRegex = /url\(['"]?([^'")\s]+\.ttf)['"]?\)/gi;
  let ttfMatch;
  while ((ttfMatch = ttfRegex.exec(cssContent)) !== null) {
    const ttfPath = ttfMatch[1];
    const ttfBaseName = path.basename(ttfPath).replace(/\.ttf$/i, '');
    
    // Check if we have this font in WOFF2 or WOFF format
    if (fontFormatMap.has(ttfBaseName)) {
      const formats = fontFormatMap.get(ttfBaseName);
      // Sort prioritizing WOFF2, then WOFF
      formats.sort((a, b) => {
        if (a.format.includes('woff2')) return -1;
        if (b.format.includes('woff2')) return 1;
        if (a.format.includes('woff')) return -1;
        if (b.format.includes('woff')) return 1;
        return 0;
      });
      
      // If we have a WOFF2 or WOFF format, use it instead of TTF
      if (formats.length > 0 && (formats[0].format.includes('woff') || formats[0].format.includes('woff2'))) {
        const fontFileName = path.basename(formats[0].path);
        // Replace the TTF reference with the best available format
        const escapedTtfPath = ttfPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const ttfReplaceRegex = new RegExp(`url\\(['"]?${escapedTtfPath}['"]?\\)`, 'gi');
        updatedCSS = updatedCSS.replace(ttfReplaceRegex, `url('../fonts-flat/${fontFileName}')`);
        console.log(`✅ Replaced TTF reference for ${ttfBaseName} with ${fontFileName}`);
      }
    }
  }
  
  // Fix common problematic paths - all point to fonts-flat
  
  // Replace references to /front/assets/fonts/ with ../fonts-flat/
  updatedCSS = updatedCSS.replace(/url\(['"]?(\/front\/assets\/fonts\/([^'"\)]+))['"]?\)/g, 
      (match, fullPath, fontFile) => `url('../fonts-flat/${fontFile}')`);
      
  // Replace references to Google font paths
  updatedCSS = updatedCSS.replace(/url\(['"]?(\/s\/[^\/]+\/([^'"\)]+))['"]?\)/g, 
      (match, fullPath, fontFile) => `url('../fonts-flat/${fontFile}')`);
      
  // Replace KaTeX paths
  updatedCSS = updatedCSS.replace(/url\(['"]?(\/ajax\/libs\/KaTeX\/[^\/]+\/fonts\/([^'"\)]+))['"]?\)/g,
      (match, fullPath, fontFile) => `url('../fonts-flat/${fontFile}')`);
  
  // Replace any absolute URL paths with font extensions
  updatedCSS = updatedCSS.replace(/url\(['"]?(\/[^'")\s]+\.(woff2?|ttf|eot|otf|svg))['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('../fonts-flat/${fontFile}')`;
    });
  
  // Clean up any paths that have duplicate 'fonts/' segments
  updatedCSS = updatedCSS.replace(/url\(['"]?\.\.\/fonts-flat\/fonts\/([^'"\)]+)['"]?\)/g, 
      `url('../fonts-flat/$1')`);
  
  // Replace any remaining relative font paths to use fonts-flat
  updatedCSS = updatedCSS.replace(/url\(['"]?(?:\.\.\/)*fonts\/([^'"\)]+)['"]?\)/g, 
      `url('../fonts-flat/$1')`);
  
  // Replace any direct references to font files without a directory
  updatedCSS = updatedCSS.replace(/url\(['"]?([^'"\)\/]+\.(woff2?|ttf|eot|otf|svg))['"]?\)/gi, 
      `url('../fonts-flat/$1')`);
  
  // Add multiple fallback paths for compatibility
  updatedCSS = updatedCSS.replace(/url\(['"]?\.\.\/fonts-flat\/([^'"\)]+)['"]?\)/g, 
      (match, fontFile) => `url('../fonts-flat/${fontFile}'), url('./fonts-flat/${fontFile}'), url('/fonts-flat/${fontFile}'), url('/fonts/${fontFile}')`);
  
  return updatedCSS;
}

/**
 * Filter @font-face blocks to only include relevant fonts and update their paths
 * @param {Array} fontFaceBlocks - Array of @font-face declaration blocks
 * @param {Array} fontPaths - Array of downloaded font paths
 * @returns {Array} - Filtered and updated @font-face blocks
 */
function filterFontFaces(fontFaceBlocks, fontPaths) {
  // Extract just the filenames from our downloaded font paths for easier matching
  const downloadedFontFilenames = fontPaths.map(({ localPath }) => path.basename(localPath));
  
  // Create a map of original URLs to filenames for replacement
  const fontUrlMap = new Map();
  fontPaths.forEach(({ originalUrl, localPath }) => {
    fontUrlMap.set(originalUrl, path.basename(localPath));
  });
  
  // Create a mapping of font base names to their available formats
  const fontFormatMap = new Map();
  fontPaths.forEach(({originalUrl, localPath}) => {
    const fontBaseName = path.basename(localPath).replace(/\.(woff2?|ttf|eot|otf|svg)$/i, '');
    const format = path.extname(localPath).toLowerCase();
    
    if (!fontFormatMap.has(fontBaseName)) {
      fontFormatMap.set(fontBaseName, []);
    }
    fontFormatMap.get(fontBaseName).push({format, path: localPath});
  });
  
  // Filter and update font-face blocks
  const updatedFontFaces = fontFaceBlocks.map(block => {
    // Extract URLs from this font-face block
    const fontUrlRegex = /url\(['"]?([^'"\)]+\.(woff2?|ttf|eot|otf|svg))['"]?\)/gi;
    let match;
    const blockUrls = [];
    let updatedBlock = block;
    
    // Find all URLs in this block
    while (match = fontUrlRegex.exec(block)) {
      blockUrls.push(match[1]);
    }
    
    // For each URL in the block, check if we have a downloaded version
    blockUrls.forEach(url => {
      const fontFilename = path.basename(url);
      const fontBaseName = fontFilename.replace(/\.(woff2?|ttf|eot|otf|svg)$/i, '');
      
      // If we have this font downloaded or a matching filename
      if (fontUrlMap.has(url) || downloadedFontFilenames.includes(fontFilename)) {
        // Replace the URL with our flat directory path
        const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`url\\(['"]?${escapedUrl}['"]?\\)`, 'g');
        updatedBlock = updatedBlock.replace(regex, `url('../fonts-flat/${fontFilename}')`);
      } 
      // If it's a TTF that we don't have but we have WOFF/WOFF2 version
      else if (url.endsWith('.ttf') && fontFormatMap.has(fontBaseName)) {
        const formats = fontFormatMap.get(fontBaseName);
        // Sort prioritizing WOFF2, then WOFF
        formats.sort((a, b) => {
          if (a.format.includes('woff2')) return -1;
          if (b.format.includes('woff2')) return 1;
          if (a.format.includes('woff')) return -1;
          if (b.format.includes('woff')) return 1;
          return 0;
        });
        
        if (formats.length > 0) {
          const fontFileName = path.basename(formats[0].path);
          // Replace the TTF reference with the best available format
          const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`url\\(['"]?${escapedUrl}['"]?\\)`, 'g');
          updatedBlock = updatedBlock.replace(regex, `url('../fonts-flat/${fontFileName}')`);
          console.log(`✅ In @font-face: Replaced TTF reference for ${fontBaseName} with ${fontFileName}`);
        }
      }
    });
    
    // Apply additional replacements for common patterns
    // Replace references to /front/assets/fonts/
    updatedBlock = updatedBlock.replace(/url\(['"]?(\/front\/assets\/fonts\/([^'"\)]+))['"]?\)/g, 
        (match, fullPath, fontFile) => `url('../fonts-flat/${fontFile}')`);
        
    // Replace references to Google font paths
    updatedBlock = updatedBlock.replace(/url\(['"]?(\/s\/[^\/]+\/([^'"\)]+))['"]?\)/g, 
        (match, fullPath, fontFile) => `url('../fonts-flat/${fontFile}')`);
        
    // Replace KaTeX paths
    updatedBlock = updatedBlock.replace(/url\(['"]?(\/ajax\/libs\/KaTeX\/[^\/]+\/fonts\/([^'"\)]+))['"]?\)/g,
        (match, fullPath, fontFile) => `url('../fonts-flat/${fontFile}')`);
    
    // Replace any absolute URL paths with font extensions
    updatedBlock = updatedBlock.replace(/url\(['"]?(\/[^'")\s]+\.(woff2?|ttf|eot|otf|svg))['"]?\)/gi, 
      (match, fontPath) => {
        const fontFile = path.basename(fontPath);
        return `url('../fonts-flat/${fontFile}')`;
      });

    // Add multiple fallback paths for compatibility
    updatedBlock = updatedBlock.replace(/url\(['"]?\.\.\/fonts-flat\/([^'"\)]+)['"]?\)/g, 
        (match, fontFile) => `url('../fonts-flat/${fontFile}'), url('./fonts-flat/${fontFile}'), url('/fonts-flat/${fontFile}'), url('/fonts/${fontFile}')`);
    
    return updatedBlock;
  });
  
  // Filter out any blocks that don't have any of our downloaded fonts
  // This is important to avoid CSS referencing fonts we don't have
  return updatedFontFaces.filter(block => {
    const fontUrlRegex = /url\(['"]?\.\.\/fonts-flat\/([^'"\)]+)['"]?\)/gi;
    return fontUrlRegex.test(block);
  });
}

/**
 * Main font extraction function that processes HTML and CSS
 * @param {string} html - HTML content
 * @param {Array} cssFiles - Array of {url, content, filename} objects
 * @param {string} baseUrl - Base URL of the website
 * @param {string} outputDir - Output directory
 * @returns {Promise<Object>} - Object with fontPaths and fontFaceCssPath
 */
async function extractFonts(html, cssFiles, baseUrl, outputDir) {
  console.log('🔍 Extracting fonts from CSS files...');
  
  // Process each CSS file
  const allFontPaths = [];
  
  // Store all font face declarations
  const allFontFaces = [];
  
  // Ensure fonts-flat directory exists
  const flatFontsDir = path.join(outputDir, 'fonts-flat');
  fs.mkdirSync(flatFontsDir, { recursive: true });
  
  for (const {url, content, filename} of cssFiles) {
    console.log(`Processing CSS file: ${filename}`);
    
    // Extract font face declarations
    const fontFaceBlocks = content.match(/@font-face\s*{[^}]*}/g) || [];
    if (fontFaceBlocks.length > 0) {
      allFontFaces.push(...fontFaceBlocks);
      console.log(`Found ${fontFaceBlocks.length} @font-face declarations in ${filename}`);
    }
    
    // Extract and download fonts
    const fontPaths = await extractFontsFromCSS(
      content,
      baseUrl,
      url,
      outputDir
    );
    
    allFontPaths.push(...fontPaths);
    
    // Rewrite CSS with local paths - but skip font-face declarations as we'll handle them separately
    if (fontPaths.length > 0) {
      let updatedCSS = content;
      
      // Remove @font-face blocks from the original CSS
      fontFaceBlocks.forEach(block => {
        updatedCSS = updatedCSS.replace(block, '');
      });
      
      // Replace any remaining font references
      updatedCSS = rewriteCSSFontPaths(updatedCSS, fontPaths);
      
      fs.writeFileSync(path.join(outputDir, filename), updatedCSS);
      console.log(`✅ Updated font paths in ${filename}`);
    }
  }
  
  // Create a dedicated CSS file for font-face declarations
  if (allFontFaces.length > 0 && allFontPaths.length > 0) {
    // Filter to include relevant font-face declarations
    const filteredFontFaces = filterFontFaces(allFontFaces, allFontPaths);
    console.log(`Filtered ${allFontFaces.length} font faces to ${filteredFontFaces.length} relevant font faces`);
    
    // Create font-face-only CSS with local paths
    let fontFacesContent = filteredFontFaces.join('\n\n');
    fontFacesContent = rewriteCSSFontPaths(fontFacesContent, allFontPaths);
    
    // Write to a dedicated file
    const fontFaceCssPath = path.join(outputDir, 'font-faces.css');
    fs.writeFileSync(fontFaceCssPath, fontFacesContent);
    console.log(`✅ Created font-faces.css with ${filteredFontFaces.length} font-face declarations`);
    
    // List all the fonts in the flat dir for verification
    const fontFiles = fs.readdirSync(flatFontsDir);
    console.log(`✅ Fonts-flat directory contains ${fontFiles.length} font files`);
    
    console.log(`🎉 Font extraction complete. Downloaded ${allFontPaths.length} fonts.`);
    return {
      fontPaths: allFontPaths,
      fontFaceCssPath: 'font-faces.css',
      flatFontsDirName: 'fonts-flat'
    };
  }
  
  console.log(`🎉 Font extraction complete. Downloaded ${allFontPaths.length} fonts.`);
  return {
    fontPaths: allFontPaths,
    fontFaceCssPath: null,
    flatFontsDirName: 'fonts-flat'
  };
}

module.exports = {
  extractFonts,
  extractFontsFromCSS,
  rewriteCSSFontPaths
}; 