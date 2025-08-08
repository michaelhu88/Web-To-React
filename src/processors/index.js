/**
 * Processor factory for selecting the appropriate route processing strategy
 * 
 * This module provides:
 * - Modular strategy: Component-specific CSS files (ideal for Tailwind/component-based sites)
 * - Global strategy: Single global.css file (ideal for Webflow/monolithic CSS sites)
 */

const processRouteModular = require('./processRouteModular');
const { processRoute: processRouteGlobal, writeGlobalCSS, resetGlobalCSS } = require('./processRouteGlobal');

/**
 * Available processing strategies
 */
const STRATEGIES = {
  MODULAR: 'modular',
  GLOBAL: 'global'
};

/**
 * Get the appropriate processor based on strategy
 * @param {string} strategy - Processing strategy ('modular' or 'global')
 * @returns {Function} The processor function
 */
function getProcessor(strategy = STRATEGIES.MODULAR) {
  switch (strategy.toLowerCase()) {
    case STRATEGIES.GLOBAL:
      return processRouteGlobal;
    case STRATEGIES.MODULAR:
    default:
      return processRouteModular;
  }
}

/**
 * Auto-detect the best strategy based on CSS analysis
 * @param {string} url - URL to analyze
 * @returns {Promise<string>} Recommended strategy
 */
async function detectStrategy(url) {
  // TODO: Implement auto-detection logic based on:
  // - CSS file count and size
  // - Presence of Tailwind classes
  // - CSS organization patterns
  // For now, default to modular
  return STRATEGIES.MODULAR;
}

/**
 * Process multiple routes with the specified strategy
 * @param {Array} routes - Array of route objects with {url, componentName}
 * @param {string} strategy - Processing strategy
 * @param {string} outputDir - Output directory
 * @param {Object} options - Additional options
 * @returns {Promise<Array>} Array of processed results
 */
async function processMultipleRoutes(routes, strategy = STRATEGIES.MODULAR, outputDir, options = {}) {
  const processor = getProcessor(strategy);
  const results = [];
  
  // Reset global CSS if using global strategy
  if (strategy === STRATEGIES.GLOBAL) {
    resetGlobalCSS();
    console.log(`🌐 Using Global CSS strategy for ${routes.length} routes`);
  } else {
    console.log(`📦 Using Modular CSS strategy for ${routes.length} routes`);
  }
  
  // Process each route
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    console.log(`\n📄 Processing route ${i + 1}/${routes.length}: ${route.url} => ${route.componentName}`);
    
    try {
      const result = await processor(route.url, route.componentName, false, true, outputDir);
      results.push(result);
    } catch (error) {
      console.error(`❌ Error processing route ${route.url}: ${error.message}`);
      // Continue with next route even if this one failed
    }
  }
  
  // Write global CSS file if using global strategy
  if (strategy === STRATEGIES.GLOBAL && results.length > 0) {
    console.log(`\n🌐 Writing consolidated global CSS file...`);
    const globalCssPath = writeGlobalCSS(outputDir);
    console.log(`✅ Global CSS consolidation complete: ${globalCssPath}`);
  }
  
  console.log(`\n✅ Processed ${results.length}/${routes.length} routes successfully using ${strategy} strategy`);
  return results;
}

module.exports = {
  STRATEGIES,
  getProcessor,
  detectStrategy,
  processMultipleRoutes,
  // Export individual processors for direct use
  processRouteModular,
  processRouteGlobal,
  writeGlobalCSS,
  resetGlobalCSS
};