/**
 * Script to clean up the output directory before running tests
 */
const fs = require('fs');
const path = require('path');

const outputDir = path.resolve(__dirname, '../output');

/**
 * Recursively removes a directory and its contents
 * @param {string} dirPath - Directory path to remove
 */
function removeDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
      const currentPath = path.join(dirPath, file);
      
      if (fs.lstatSync(currentPath).isDirectory()) {
        // Recursive call for directories
        removeDirectory(currentPath);
      } else {
        // Delete file
        fs.unlinkSync(currentPath);
      }
    }
    
    fs.rmdirSync(dirPath);
  }
}

/**
 * Clean up output directories
 */
function cleanOutputDir() {
  console.log(`🧹 Cleaning output directory: ${outputDir}`);
  
  try {
    // Define directories to clean
    const directoriesToClean = [
      path.join(outputDir, 'styles'),
      path.join(outputDir, 'html'),
      path.join(outputDir, 'components'),
      path.join(outputDir, 'public')
    ];
    
    // Clean each directory
    for (const dir of directoriesToClean) {
      if (fs.existsSync(dir)) {
        console.log(`📂 Removing ${dir}`);
        removeDirectory(dir);
      }
    }
    
    // Recreate empty directories
    for (const dir of directoriesToClean) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📂 Created empty directory: ${dir}`);
    }
    
    console.log('✅ Output directories cleaned successfully!');
  } catch (error) {
    console.error(`❌ Error cleaning output directories: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  cleanOutputDir();
}

module.exports = cleanOutputDir; 