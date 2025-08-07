const puppeteer = require('puppeteer');
const fs = require('fs');
const { createBrowserWithProxy, createAuthenticatedPage } = require('../utils/puppeteerConfig');

/**
 * Helper function to wait for a specified time
 */
async function wait(page, ms) {
  return page.evaluate((ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
  }, ms);
}

/**
 * Counts nesting levels in a URL path
 * 
 * @param {string} urlStr - The URL to check
 * @returns {number} - The number of nesting levels
 */
function countNestingLevels(urlStr) {
  try {
    const parsedUrl = new URL(urlStr);
    // Get the pathname and remove leading/trailing slashes
    const pathname = parsedUrl.pathname.replace(/^\/+|\/+$/g, '');
    
    // If pathname is empty, return 0
    if (!pathname) {
      return 0;
    }
    
    // Split by slashes and count segments
    const segments = pathname.split('/').filter(segment => segment.length > 0);
    return segments.length;
  } catch (e) {
    return 0;
  }
}

/**
 * Extracts route name from a URL path
 * 
 * @param {string} urlStr - The URL to extract the route name from
 * @returns {string} - The route name
 */
function getRouteNameFromUrl(urlStr) {
  try {
    const parsedUrl = new URL(urlStr);
    // Get the pathname and remove leading/trailing slashes
    const pathname = parsedUrl.pathname.replace(/^\/+|\/+$/g, '');
    
    // If pathname is empty, return 'home'
    if (!pathname) {
      return '/home';
    }
    
    // Get the last part of the pathname (after the last slash)
    const parts = pathname.split('/');
    let routeName = parts[parts.length - 1];
    
    // Handle common patterns
    if (routeName.includes('.')) {
      // Remove file extensions if present
      routeName = routeName.split('.')[0];
    }
    
    return `/${routeName || pathname}`;
  } catch (e) {
    return `/${urlStr}`;
  }
}

/**
 * Normalizes a URL by removing trailing slashes and standardizing the format
 * 
 * @param {string} urlStr - The URL to normalize
 * @returns {string} - The normalized URL
 */
function normalizeUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    // Remove trailing slash from pathname if it exists
    url.pathname = url.pathname.replace(/\/+$/, '');
    // For root path, ensure it's consistent
    if (url.pathname === '') {
      url.pathname = '/';
    }
    // Remove hash fragments
    url.hash = '';
    
    return url.toString().replace(/\/$/, '');
  } catch (e) {
    return urlStr;
  }
}

/**
 * Generates a component name from a URL
 * 
 * @param {string} urlStr - The URL to extract the component name from
 * @returns {string} - The component name in PascalCase
 */
function getComponentNameFromUrl(urlStr) {
  try {
    const parsedUrl = new URL(urlStr);
    // Get the pathname and remove leading/trailing slashes
    const pathname = parsedUrl.pathname.replace(/^\/+|\/+$/g, '');
    
    // If pathname is empty, return 'Home'
    if (!pathname) {
      return 'Home';
    }
    
    // Get the last part of the pathname (after the last slash)
    const parts = pathname.split('/');
    let routeName = parts[parts.length - 1];
    
    // Handle common patterns
    if (routeName.includes('.')) {
      // Remove file extensions if present
      routeName = routeName.split('.')[0];
    }

    // Convert hyphens to PascalCase
    if (routeName.includes('-')) {
      return routeName
        .split('-')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('');
    }

    // Handle underscores similarly
    if (routeName.includes('_')) {
      return routeName
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('');
    }

    // Convert to PascalCase
    return routeName.charAt(0).toUpperCase() + routeName.slice(1);
  } catch (e) {
    return 'Page';
  }
}

/**
 * Discovers all first-level routes of a website by clicking on links and buttons
 * 
 * @param {string} startUrl - The URL to start the discovery from
 * @param {string} outputPath - Optional path to save routes to a JSON file
 * @param {number} timeoutMs - Timeout in milliseconds (default: 300000 - 5 minutes)
 * @param {number} returnHomeTimeoutMs - Timeout in milliseconds for returning to the home page (default: 5000ms)
 * @returns {Promise<Object>} - A map of route names to their URLs
 */
async function findFirstLevelRoutes(
  startUrl, 
  outputPath = null, 
  timeoutMs = 300000, 
  returnHomeTimeoutMs = 5000
) {
  console.log(`🔍 Discovering routes from: ${startUrl}`);
  
  // Normalize the starting URL
  const normalizedStartUrl = normalizeUrl(startUrl);
  
  // Parse the base URL
  const parsedStartUrl = new URL(normalizedStartUrl);
  const baseUrl = `${parsedStartUrl.protocol}//${parsedStartUrl.host}`;
  
  const browser = await createBrowserWithProxy({
    headless: 'new',
    args: ['--disable-dev-shm-usage']
  });
  
  // Store discovered routes as an array of objects
  const routes = [
    {
      url: normalizedStartUrl,
      componentName: 'Home'
    }
  ];
  
  // Keep track of URLs we've already visited or queued
  const visitedUrls = new Set([normalizedStartUrl]);
  
  try {
    const page = await createAuthenticatedPage(browser);
    
    // Set viewport to a reasonable desktop size
    await page.setViewport({ width: 1280, height: 800 });
    
    // Disable navigation timeouts
    page.setDefaultNavigationTimeout(timeoutMs);
    
    // Navigate to the starting URL
    console.log(`⏳ Navigating to starting URL: ${startUrl}`);
    await page.goto(startUrl, { 
      waitUntil: ['load', 'networkidle0'],
      timeout: timeoutMs
    });
    
    // Wait for any post-load JavaScript
    await wait(page, 3000);
    
    console.log('🔍 Finding all clickable elements...');
    
    // Find all links on the page (first level)
    const clickableElements = await page.evaluate(() => {
      // Find all <a> tags with href
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ 
          type: 'link',
          href: a.href,
          text: a.innerText.trim() || a.textContent.trim() || 'link',
          selector: `a[href="${a.getAttribute('href')}"]`
        }))
        .filter(link => {
          // Filter out non-http links (mailto:, tel:, etc)
          return link.href.startsWith('http') || link.href.startsWith('/');
        });
      
      // Find buttons that might trigger navigation using event listeners
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], .btn, .button'))
        .map((btn, index) => ({
          type: 'button',
          text: btn.innerText.trim() || btn.textContent.trim() || `button-${index}`,
          selector: (() => {
            // Try to create a unique selector for each button
            if (btn.id) return `#${btn.id}`;
            if (btn.className) {
              const classes = Array.from(btn.classList).join('.');
              return `.${classes}`;
            }
            // Fallback to a path selector
            let path = '';
            let el = btn;
            while (el && el !== document.body) {
              let sibCount = 0;
              let sibIndex = 0;
              for (let sib = el.previousSibling; sib; sib = sib.previousSibling) {
                if (sib.nodeType === 1 && sib.tagName === el.tagName) {
                  sibCount++;
                }
              }
              for (let sib = el; sib; sib = sib.previousSibling) {
                if (sib.nodeType === 1 && sib.tagName === el.tagName) {
                  sibIndex++;
                }
              }
              const tagName = el.tagName.toLowerCase();
              path = sibCount > 0 ? `${tagName}:nth-of-type(${sibIndex})>${path}` : `${tagName}>${path}`;
              el = el.parentNode;
            }
            return path.slice(0, -1); // remove trailing >
          })()
        }));
      
      // Also include navigation menus and common navigation elements
      const navItems = Array.from(document.querySelectorAll('nav a, .nav a, .navbar a, .menu a, .navigation a, header a'))
        .map(navLink => ({
          type: 'nav-link',
          href: navLink.href,
          text: navLink.innerText.trim() || navLink.textContent.trim() || 'nav-item',
          selector: `a[href="${navLink.getAttribute('href')}"]`
        }))
        .filter(link => {
          return link.href.startsWith('http') || link.href.startsWith('/');
        });
      
      return [...links, ...buttons, ...navItems];
    });
    
    console.log(`🔗 Found ${clickableElements.length} clickable elements`);
    
    // Process each clickable element
    for (let i = 0; i < clickableElements.length; i++) {
      const element = clickableElements[i];
      
      // Skip elements we've already checked
      if (element.href && visitedUrls.has(element.href)) {
        continue;
      }
      
      // Check URL nesting depth
      if (element.href) {
        const nestingLevels = countNestingLevels(element.href);
        if (nestingLevels > 1) {
          console.log(`⛔ Skipping deeply nested URL: ${element.href} (${nestingLevels} levels)`);
          continue;
        }
      }
      
      // For each element, create a new page so we don't lose our place
      const newPage = await createAuthenticatedPage(browser);
      await newPage.setViewport({ width: 1280, height: 800 });
      
      try {
        // First navigate to the starting URL
        await newPage.goto(startUrl, { waitUntil: 'networkidle0', timeout: timeoutMs });
        await wait(newPage, 1000); // Wait a bit for JS to initialize
        
        console.log(`👆 Clicking element: ${element.text} (${element.type})`);
        
        // Different handling based on element type
        if (element.type === 'link' || element.type === 'nav-link') {
          // For links, we can navigate directly to their href
          if (element.href && (element.href.startsWith('http') || element.href.startsWith('/'))) {
            // Only handle links to the same domain or relative paths
            const targetUrl = new URL(element.href, baseUrl);
            if (targetUrl.hostname === parsedStartUrl.hostname) {
              await newPage.goto(element.href, { waitUntil: 'networkidle0', timeout: timeoutMs });
            } else {
              console.log(`⚠️ Skipping external link: ${element.href}`);
              continue;
            }
          }
        } else {
          // Find and click the button
          try {
            await newPage.waitForSelector(element.selector, { timeout: 5000 });
            await newPage.click(element.selector);
            await wait(newPage, 3000); // Wait for any navigation to complete
          } catch (e) {
            console.log(`⚠️ Failed to find or click: ${element.selector}`);
            continue;
          }
        }
        
        // Check if URL has changed
        const currentUrl = await newPage.url();
        const normalizedCurrentUrl = normalizeUrl(currentUrl);
        
        if (normalizedCurrentUrl !== normalizedStartUrl) {
          visitedUrls.add(normalizedCurrentUrl);
          
          // Parse the URL to extract the path
          const parsedUrl = new URL(normalizedCurrentUrl);
          
          // Only include URLs from the same domain
          if (parsedUrl.hostname === parsedStartUrl.hostname) {
            const componentName = getComponentNameFromUrl(normalizedCurrentUrl);
            console.log(`✅ Discovered route: ${componentName} -> ${normalizedCurrentUrl}`);
            
            // Add to routes array if not already present
            const alreadyExists = routes.some(route => normalizeUrl(route.url) === normalizedCurrentUrl);
            if (!alreadyExists) {
              routes.push({
                url: normalizedCurrentUrl,
                componentName
              });
            }
          }
          
          // Try to go back to the home page
          console.log(`🏠 Attempting to return to home page with ${returnHomeTimeoutMs}ms timeout...`);
          try {
            // First try to use browser back button
            await Promise.race([
              newPage.goBack({ waitUntil: 'networkidle0' }),
              wait(newPage, returnHomeTimeoutMs)
            ]);
            
            // Check if we're back at the start URL
            const afterBackUrl = await newPage.url();
            if (afterBackUrl !== startUrl) {
              console.log(`⚠️ Could not return to home page with back button, navigating directly...`);
              await newPage.goto(startUrl, { waitUntil: 'networkidle0', timeout: timeoutMs });
            }
          } catch (e) {
            console.log(`⚠️ Error returning to home page: ${e.message}`);
            console.log(`🔄 Navigating directly to home page...`);
            await newPage.goto(startUrl, { waitUntil: 'networkidle0', timeout: timeoutMs });
          }
        }
      } catch (e) {
        console.error(`❌ Error processing element ${i}: ${e.message}`);
      } finally {
        // Close the page when done
        await newPage.close();
      }
    }
    
    console.log(`🎉 Discovery complete! Found ${routes.length} routes.`);
    
    // Save to file if outputPath is provided
    if (outputPath) {
      const jsonOutput = JSON.stringify(routes, null, 2);
      fs.writeFileSync(outputPath, jsonOutput);
      console.log(`📁 Routes saved to: ${outputPath}`);
    }
    
    return routes;
    
  } finally {
    await browser.close();
    console.log('🔒 Browser closed');
  }
}

// If this file is run directly (not imported)
if (require.main === module) {
  const startUrl = process.argv[2];
  const outputPath = process.argv[3] || 'discovered-routes.json';
  const timeout = process.argv[4] ? parseInt(process.argv[4]) : 300000;
  const returnHomeTimeout = process.argv[5] ? parseInt(process.argv[5]) : 5000;
  
  if (!startUrl) {
    console.error('❌ Please provide a starting URL as the first argument');
    console.error('Usage: node findRoutesWithPuppeteer.js <startUrl> [outputPath] [timeoutMs] [returnHomeTimeoutMs]');
    process.exit(1);
  }
  
  findFirstLevelRoutes(startUrl, outputPath, timeout, returnHomeTimeout)
    .then(() => console.log('✨ Done!'))
    .catch(err => {
      console.error('❌ Error:', err);
      process.exit(1);
    });
} else {
  // Export for use in other files
  module.exports = findFirstLevelRoutes;
}
