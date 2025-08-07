const puppeteer = require('puppeteer');
require('dotenv').config();

/**
 * Creates a Puppeteer browser instance with residential proxy configuration
 * Uses DataImpulse residential proxy to avoid rate limiting
 * 
 * @param {Object} options - Additional browser launch options
 * @returns {Promise<Browser>} - Configured Puppeteer browser instance
 */
async function createBrowserWithProxy(options = {}) {
  // Proxy configuration from environment variables or defaults
  const proxyHost = process.env.PROXY_HOST;
  const proxyPort = process.env.PROXY_PORT;
  
  // Default browser launch arguments with proxy
  const defaultArgs = [
    '--no-sandbox', 
    '--disable-setuid-sandbox',
    `--proxy-server=http://${proxyHost}:${proxyPort}`
  ];
  
  // Merge with any additional arguments
  const args = [...defaultArgs, ...(options.args || [])];
  
  // Launch browser with proxy configuration
  const browser = await puppeteer.launch({
    headless: true,
    args,
    ...options
  });
  
  console.log(`🌐 Browser launched with residential proxy: ${proxyHost}:${proxyPort}`);
  
  return browser;
}

/**
 * Creates a new page with proxy authentication
 * Must be called for each new page to authenticate with the proxy
 * 
 * @param {Browser} browser - Puppeteer browser instance
 * @returns {Promise<Page>} - Authenticated page instance
 */
async function createAuthenticatedPage(browser) {
  const proxyUsername = process.env.PROXY_USERNAME;
  const proxyPassword = process.env.PROXY_PASSWORD;
  
  const page = await browser.newPage();
  
  // Authenticate with the proxy
  await page.authenticate({
    username: proxyUsername,
    password: proxyPassword
  });
  
  return page;
}

module.exports = {
  createBrowserWithProxy,
  createAuthenticatedPage
};