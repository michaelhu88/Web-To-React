const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Sanitize a filename by removing invalid characters for file systems and react imports
 * @param {string} name - The original filename
 * @returns {string} - Sanitized filename
 */
function sanitizeFilename(name) {
  try {
    // Try to decode percent-encoded sequences first
    let decoded = decodeURIComponent(name);
    
    // Extract file extension
    const extMatch = decoded.match(/\.(svg|png|jpg|jpeg|gif|webp|avif)$/i);
    const extension = extMatch ? extMatch[0] : '';
    const basename = extension ? decoded.slice(0, -extension.length) : decoded;
    
    // Replace all special characters with underscores (dots, hashes, etc.)
    let sanitized = basename.replace(/[^a-zA-Z0-9]/g, '_');
    
    // Remove multiple consecutive underscores
    sanitized = sanitized.replace(/_+/g, '_');
    
    // Remove leading/trailing underscores
    sanitized = sanitized.replace(/^_+|_+$/g, '');
    
    // Prepend underscore to all filenames as requested
    sanitized = `_${sanitized}`;
    
    // Add back the extension
    return sanitized + extension;
  } catch (error) {
    // If decoding fails, just sanitize the original
    const extMatch = name.match(/\.(svg|png|jpg|jpeg|gif|webp|avif)$/i);
    const extension = extMatch ? extMatch[0] : '';
    const basename = extension ? name.slice(0, -extension.length) : name;
    
    let sanitized = basename.replace(/[^a-zA-Z0-9]/g, '_');
    sanitized = sanitized.replace(/_+/g, '_');
    sanitized = sanitized.replace(/^_+|_+$/g, '');
    sanitized = `_${sanitized}`;
    
    return sanitized + extension;
  }
}

/**
 * Extracts images from HTML and CSS content, downloads them,
 * and rewrites the references to point to local files
 * 
 * @param {string} html - HTML content to analyze
 * @param {Array} cssFiles - Array of {url, content, filename} objects
 * @param {string} baseUrl - Base URL of the website
 * @param {string} outputDir - Directory to save the images
 * @returns {Promise<Array>} - Array of downloaded image information
 */
async function extractImages(html, cssFiles, baseUrl, outputDir) {
  console.log('🔍 Extracting images from HTML and CSS...');
  
  // Create only flat images directory
  const imagesFlatDir = path.join(outputDir, 'images-flat');
  fs.mkdirSync(imagesFlatDir, { recursive: true });
  
  const imageUrls = new Set();
  const processedImages = [];
  
  // 1. Extract image URLs from HTML
  const $ = cheerio.load(html);
  
  // Extract from <img> tags
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    const dataSrc = $(el).attr('data-src'); // Common lazy loading attribute
    const dataOriginal = $(el).attr('data-original'); // Another lazy loading pattern
    const dataLazy = $(el).attr('data-lazy'); // Yet another lazy loading pattern
    
    if (src && !src.startsWith('data:')) imageUrls.add(src); // Skip data URLs
    if (dataSrc && !dataSrc.startsWith('data:')) imageUrls.add(dataSrc); // Include lazy-loaded images
    if (dataOriginal && !dataOriginal.startsWith('data:')) imageUrls.add(dataOriginal);
    if (dataLazy && !dataLazy.startsWith('data:')) imageUrls.add(dataLazy);
    
    // Also check srcset attribute
    const srcset = $(el).attr('srcset');
    if (srcset) {
      // Parse srcset format: "url1 1x, url2 2x, ..."
      srcset.split(',').forEach(item => {
        const parts = item.trim().split(' ');
        if (parts.length >= 1) {
          const url = parts[0].trim();
          if (!url.startsWith('data:')) imageUrls.add(url);
        }
      });
    }
  });
  
  // Extract from <picture> and <source> tags
  $('picture source').each((_, el) => {
    const srcset = $(el).attr('srcset');
    if (srcset) {
      srcset.split(',').forEach(item => {
        const parts = item.trim().split(' ');
        if (parts.length >= 1) imageUrls.add(parts[0].trim());
      });
    }
  });
  
  // Extract from inline background styles
  $('[style*="background"]').each((_, el) => {
    const style = $(el).attr('style');
    if (style) {
      const urlMatches = style.match(/url\(['"]?([^'"\)]+)['"]?\)/g);
      if (urlMatches) {
        urlMatches.forEach(match => {
          const url = match.replace(/url\(['"]?([^'"\)]+)['"]?\)/, '$1');
          imageUrls.add(url);
        });
      }
    }
  });
  
  console.log(`📷 Found ${imageUrls.size} images in HTML`);
  
  // 2. Extract image URLs from CSS
  const cssImageUrls = new Set();
  
  cssFiles.forEach(({content}) => {
    // Match url() with image extensions
    const imageRegex = /url\(['"]?([^'"\)]+\.(png|jpg|jpeg|gif|svg|webp|avif|ico))['"]?\)/gi;
    let match;
    
    while (match = imageRegex.exec(content)) {
      cssImageUrls.add(match[1]);
    }
  });
  
  console.log(`📷 Found ${cssImageUrls.size} images in CSS`);
  
  // Combine all image URLs
  cssImageUrls.forEach(url => imageUrls.add(url));
  
  // 3. Download images and rewrite URLs
  console.log(`📥 Downloading ${imageUrls.size} images...`);
  
  // Create mapping from original URL to sanitized filename
  const urlToSanitizedMap = new Map();
  
  const downloadPromises = Array.from(imageUrls).map(async imageUrl => {
    try {
      // Resolve URL (handle relative/absolute paths)
      let fullImageUrl;
      if (imageUrl.startsWith('http')) {
        fullImageUrl = imageUrl;
      } else if (imageUrl.startsWith('data:')) {
        // Skip data URLs
        console.log(`⏩ Skipping data URL (starts with data:)`);
        return;
      } else if (imageUrl.startsWith('//')) {
        // Protocol-relative URL
        fullImageUrl = `https:${imageUrl}`;
      } else if (imageUrl.startsWith('/')) {
        // Absolute path from domain root
        fullImageUrl = new URL(imageUrl, baseUrl).href;
      } else {
        // Relative path
        fullImageUrl = new URL(imageUrl, baseUrl).href;
      }
      
      // Get URL pathname
      const urlPath = new URL(fullImageUrl).pathname;
      let originalFilename = path.basename(urlPath);
      
      // Skip if filename is empty or just a slash
      if (!originalFilename || originalFilename === '/') {
        console.warn(`⚠️ Skipping URL with invalid filename: ${imageUrl}`);
        return;
      }
      
      // For potential collisions, create unique filenames using path info
      const pathDirname = path.dirname(urlPath).replace(/^\//, ''); // Remove leading slash
      
      // Check if this filename already exists for a different URL
      const existingUrl = Array.from(urlToSanitizedMap.entries())
        .find(([_, name]) => name === originalFilename);
      
      if (existingUrl && existingUrl[0] !== imageUrl) {
        // Create a unique filename by prepending a hash of the path
        const pathHash = Buffer.from(pathDirname).toString('hex').substring(0, 8);
        const extname = path.extname(originalFilename);
        const basename = path.basename(originalFilename, extname);
        originalFilename = `${basename}-${pathHash}${extname}`;
      }
      
      // Sanitize the filename for safe React usage
      const sanitizedFilename = sanitizeFilename(originalFilename);
      
      // Store the mapping
      urlToSanitizedMap.set(imageUrl, sanitizedFilename);
      
      // Download to flat directory only
      const flatPath = path.join(imagesFlatDir, sanitizedFilename);
      
      // Download image file with retry logic
      let response;
      let lastError;
      const maxRetries = 2;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await axios({
            method: 'get',
            url: fullImageUrl,
            responseType: 'arraybuffer',
            headers: {
              // Add user agent to avoid bot detection
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
              // Add referer to help with some auth issues
              'Referer': baseUrl
            },
            // Handle redirects and don't fail on SSL errors
            maxRedirects: 5,
            timeout: 15000, // 15 second timeout
            validateStatus: status => status < 400,
            httpsAgent: new (require('https').Agent)({
              rejectUnauthorized: false
            })
          });
          break; // Success, exit retry loop
        } catch (err) {
          lastError = err;
          if (attempt < maxRetries) {
            console.log(`   Retry ${attempt}/${maxRetries - 1} for: ${imageUrl}`);
            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          }
        }
      }
      
      if (!response) {
        throw lastError; // Re-throw the last error if all retries failed
      }
      
      // Write to flat directory only
      fs.writeFileSync(flatPath, response.data);
      console.log(`✅ Downloaded image: ${sanitizedFilename}`);
      
      // Add to list of processed images - now with just flat path
      processedImages.push({
        originalUrl: imageUrl,
        flatPath: `images-flat/${sanitizedFilename}`, // Use sanitized filename
        sanitizedFilename
      });
      
    } catch (err) {
      let errorType = 'Unknown';
      if (err.response) {
        errorType = `HTTP ${err.response.status}`;
        if (err.response.status === 404) errorType += ' (Not Found)';
        if (err.response.status === 403) errorType += ' (Forbidden/Auth Required)';
        if (err.response.status === 429) errorType += ' (Rate Limited)';
      } else if (err.code === 'ENOTFOUND') {
        errorType = 'DNS Resolution Failed';
      } else if (err.code === 'ETIMEDOUT') {
        errorType = 'Request Timeout';
      } else if (err.message.includes('Invalid URL')) {
        errorType = 'Invalid URL Format';
      }
      
      console.warn(`⚠️ Failed to download image: ${imageUrl}`);
      console.warn(`   Error: ${errorType} - ${err.message}`);
      
      // Optional: Create a placeholder for completely failed images
      // This can help identify missing images in the UI during development
      if (process.env.CREATE_IMAGE_PLACEHOLDERS === 'true') {
        try {
          const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">
            <rect width="200" height="150" fill="#f0f0f0" stroke="#ccc"/>
            <text x="100" y="75" text-anchor="middle" fill="#999" font-family="Arial" font-size="12">
              Image Failed to Load
            </text>
            <text x="100" y="95" text-anchor="middle" fill="#666" font-family="Arial" font-size="10">
              ${sanitizedFilename}
            </text>
          </svg>`;
          
          const placeholderPath = path.join(imagesFlatDir, sanitizedFilename.replace(/\.(png|jpg|jpeg|gif|webp|avif)$/i, '.svg'));
          fs.writeFileSync(placeholderPath, placeholderSvg);
          console.log(`📦 Created placeholder for failed image: ${path.basename(placeholderPath)}`);
          
          processedImages.push({
            originalUrl: imageUrl,
            flatPath: `images-flat/${path.basename(placeholderPath)}`,
            sanitizedFilename: path.basename(placeholderPath)
          });
        } catch (placeholderErr) {
          console.warn(`   Could not create placeholder: ${placeholderErr.message}`);
        }
      }
    }
  });
  
  await Promise.allSettled(downloadPromises);
  
  // 4. Rewrite CSS with local image paths using only the flat structure
  for (let i = 0; i < cssFiles.length; i++) {
    const { content, filename } = cssFiles[i];
    let updatedCSS = content;
    
    processedImages.forEach(({originalUrl, flatPath}) => {
      // Escape special regex characters
      const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`url\\(['"]?${escapedUrl}['"]?\\)`, 'g');
      updatedCSS = updatedCSS.replace(regex, `url('../${flatPath}')`);
    });
    
    // Fix common image path issues
    // Fix double images path that might still be in the CSS
    updatedCSS = updatedCSS.replace(/url\(['"]?\.\.\/images\/images\/([^'"\)]+)['"]?\)/g, 
      `url('../images-flat/$1')`);
    
    // Fix any path that still references the old images directory
    updatedCSS = updatedCSS.replace(/url\(['"]?\.\.\/images\/([^'"\)]+)['"]?\)/g, 
      `url('../images-flat/$1')`);
    
    // Fix another path issue where URLs might have images/images
    updatedCSS = updatedCSS.replace(/url\(['"]?\.\.\/images-flat\/images-flat\/([^'"\)]+)['"]?\)/g, 
      `url('../images-flat/$1')`);
    
    // Add multiple fallback paths for images with relative paths only
    updatedCSS = updatedCSS.replace(/url\(['"]?\.\.\/images-flat\/([^'"\)]+)['"]?\)/g, 
      (match, imgFile) => `url('../images-flat/${imgFile}'), url('./images-flat/${imgFile}')`);
    
    // Only write if changes were made
    if (updatedCSS !== content) {
      fs.writeFileSync(path.join(outputDir, filename), updatedCSS);
      console.log(`✅ Updated image paths in ${filename}`);
      cssFiles[i].content = updatedCSS;
    }
  }
  
  // 5. Rewrite HTML with local image paths using flat structure
  let updatedHtml = html;
  processedImages.forEach(({originalUrl, flatPath}) => {
    // Escape special regex characters
    const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Replace in src attributes
    const srcRegex = new RegExp(`src=["']${escapedUrl}["']`, 'g');
    updatedHtml = updatedHtml.replace(srcRegex, `src="${flatPath}"`);
    
    // Replace in srcset attributes
    const srcsetRegex = new RegExp(`(srcset=["'][^"']*)${escapedUrl}([^"']*)`, 'g');
    updatedHtml = updatedHtml.replace(srcsetRegex, `$1${flatPath}$2`);
    
    // Replace in style attributes with background images
    const styleRegex = new RegExp(`(background[^:]*:[^;]*url\\(['"]?)${escapedUrl}(['"]?\\))`, 'g');
    updatedHtml = updatedHtml.replace(styleRegex, `$1${flatPath}$2`);
  });
  
  const totalImagesFound = imageUrls.size;
  const totalImagesDownloaded = processedImages.length;
  const failedDownloads = totalImagesFound - totalImagesDownloaded;

  console.log(`🎉 Image extraction complete. Downloaded ${totalImagesDownloaded}/${totalImagesFound} images.`);
  if (failedDownloads > 0) {
    console.warn(`⚠️ ${failedDownloads} images failed to download and will not be available for JSX imports.`);
  }
  
  // Create imageMap only from successfully downloaded images
  const imageMap = {};
  processedImages.forEach(({originalUrl, sanitizedFilename}) => {
    imageMap[originalUrl] = sanitizedFilename;
  });

  return { 
    processedImages, 
    updatedHtml,
    imagesFlatDirName: 'images-flat', // Return the flat directory name for reference
    imageMap // Return mapping of only successfully downloaded images for JSX imports
  };
}

module.exports = {
  extractImages
}; 