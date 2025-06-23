const path = require('path');
const extractStylesWithPuppeteer = require('../src/extractors/extractStylesWithPuppeteer');
const downloadExternalCSS = require('../src/extractors/downloadExternalCSS');
const cleanOutputDir = require('./cleanOutput');

/**
 * Main function to extract styles from a URL using Puppeteer,
 * download any external CSS files, and extract Google Fonts only
 */
async function main() {
  try {
    // First clean the output directory
    cleanOutputDir();
    
    // URL to extract styles from
    const url = process.argv[2] || 'https://huggingface.co';
    // Use absolute path to ensure output goes to root/output/public
    const outputDir = path.resolve(__dirname, '../output/public');

    console.log(`🔍 Extracting styles and Google Fonts from ${url} to ${outputDir}`);
    
    // Extract all styles using Puppeteer (inline and JS-generated)
    const result = await extractStylesWithPuppeteer(url, outputDir);
    
    console.log('\n🎉 Style extraction complete!');
    console.log('📊 Results:');
    console.log(`- ${result.cssFiles.length} CSS files processed`);
    console.log(`- ${result.fontPaths ? result.fontPaths.length : 0} Google fonts extracted`);
    console.log(`- ${result.imagesPaths ? result.imagesPaths.length : 0} images extracted`);
    
    // Verify if any fonts were extracted
    if (result.fontPaths && result.fontPaths.length > 0) {
      console.log('✅ Successfully extracted Google Fonts!');
    } else {
      console.log('⚠️ No Google Fonts were extracted from this URL. Try a different URL that uses Google Fonts.');
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the main function
main(); 