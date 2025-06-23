const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

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
    if (src) imageUrls.add(src);
    
    // Also check srcset attribute
    const srcset = $(el).attr('srcset');
    if (srcset) {
      // Parse srcset format: "url1 1x, url2 2x, ..."
      srcset.split(',').forEach(item => {
        const parts = item.trim().split(' ');
        if (parts.length >= 1) imageUrls.add(parts[0].trim());
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
  
  // Create mapping for original path to flat filename
  const filenameMap = new Map();
  
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
      const originalFilename = path.basename(urlPath);
      
      // Skip if filename is empty or just a slash
      if (!originalFilename || originalFilename === '/') {
        console.warn(`⚠️ Skipping URL with invalid filename: ${imageUrl}`);
        return;
      }
      
      // For the flat directory structure, ensure unique filenames
      // Use path information to create a unique name if needed
      let flatFilename = originalFilename;
      const pathDirname = path.dirname(urlPath).replace(/^\//, ''); // Remove leading slash
      
      // If this filename already exists but points to a different path, make it unique
      if (filenameMap.has(flatFilename) && filenameMap.get(flatFilename) !== urlPath) {
        // Create a unique filename by prepending a hash of the path
        const pathHash = Buffer.from(pathDirname).toString('hex').substring(0, 8);
        const extname = path.extname(originalFilename);
        const basename = path.basename(originalFilename, extname);
        flatFilename = `${basename}-${pathHash}${extname}`;
      }
      
      filenameMap.set(flatFilename, urlPath);
      
      // Download to flat directory only
      const flatPath = path.join(imagesFlatDir, flatFilename);
      
      // Download image file
      const response = await axios({
        method: 'get',
        url: fullImageUrl,
        responseType: 'arraybuffer',
        // Handle redirects and don't fail on SSL errors
        maxRedirects: 5,
        timeout: 10000, // 10 second timeout
        validateStatus: status => status < 400,
        httpsAgent: new (require('https').Agent)({
          rejectUnauthorized: false
        })
      });
      
      // Write to flat directory only
      fs.writeFileSync(flatPath, response.data);
      console.log(`✅ Downloaded image: ${flatFilename}`);
      
      // Add to list of processed images - now with just flat path
      processedImages.push({
        originalUrl: imageUrl,
        flatPath: `images-flat/${flatFilename}` // Use only flat path for references
      });
      
    } catch (err) {
      console.warn(`⚠️ Failed to download image ${imageUrl}: ${err.message}`);
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
  
  console.log(`🎉 Image extraction complete. Downloaded ${processedImages.length} images.`);
  return { 
    processedImages, 
    updatedHtml,
    imagesFlatDirName: 'images-flat' // Return the flat directory name for reference
  };
}

module.exports = {
  extractImages
}; 