const puppeteer = require('puppeteer');
const fs = require('fs');
const { createBrowserWithProxy, createAuthenticatedPage } = require('../utils/puppeteerConfig');

/**
 * Extracts fully rendered HTML from a URL using Puppeteer
 * This includes all DOM changes made by JavaScript
 * 
 * @param {string} url - The URL to extract HTML from
 * @param {string} outputPath - Optional path to save HTML to a file
 * @returns {Promise<string>} - The fully rendered HTML
 */
async function extractRenderedHTML(url, outputPath = null) {
  console.log(`📄 Extracting fully rendered HTML from: ${url}`);
  const browser = await createBrowserWithProxy();
  const page = await createAuthenticatedPage(browser);
  
  try {
    // Wait until network is idle to ensure all resources are loaded
    await page.goto(url, { 
      waitUntil: ['load', 'networkidle0'],
      timeout: 120000 // 120 second timeout
    });
    
    // Optional wait to ensure JS frameworks have finished rendering
    await page.waitForTimeout(1000);
    
    // Get the fully rendered HTML
    const renderedHTML = await page.content();
    
    // Save to file if outputPath is provided
    if (outputPath) {
      fs.writeFileSync(outputPath, renderedHTML);
      console.log(`✅ Saved rendered HTML to: ${outputPath}`);
    }
    
    return renderedHTML;
  } finally {
    await browser.close();
  }
}

// If this file is run directly (not imported)
if (require.main === module) {
  const url = process.argv[2];
  const outputPath = process.argv[3] || 'rendered-page.html';
  
  if (!url) {
    console.error('❌ Please provide a URL as the first argument');
    process.exit(1);
  }
  
  extractRenderedHTML(url, outputPath)
    .then(() => console.log('✨ Done!'))
    .catch(err => {
      console.error('❌ Error:', err);
      process.exit(1);
    });
} else {
  // Export for use in other files
  module.exports = extractRenderedHTML;
} 