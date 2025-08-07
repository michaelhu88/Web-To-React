/**
 * Complete workflow for extracting styles and converting HTML to React components
 * 
 * This script:
 * 1. Extracts the fully rendered HTML from a URL (including JS-rendered content)
 * 2. Extracts all styles (inline, computed, and external CSS)
 * 3. Converts the HTML to JSX using your converter
 * 4. Creates a complete React component with proper style imports
 * 5. Optionally creates a full React project ready to run
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const processRoute = require('./src/processors/processRoute');
const { setupTailwind, fixCssLayerDirectives } = require('./scripts/setupTailwind');
const findFirstLevelRoutes = require('./src/extractors/findRoutesWithPuppeteer');

async function convertToReactComponent(url, options = {}) {
  const {
    componentName = 'ExtractedComponent',
    outputDir = path.resolve(__dirname, 'output'),
    htmlDir = path.join(outputDir, 'html'),
    stylesDir = path.join(outputDir, 'src/styles'),
    componentsDir = path.join(outputDir, 'src/components'),
    pagesDir = path.join(outputDir, 'src/pages'),
    createReactApp = false,
    reactAppName = componentName.toLowerCase() + '-app',
    includeComputedStyles = false,
    setupTailwindCSS = true
  } = options;

  console.log(`🚀 Starting conversion process for: ${url}`);
  console.log(`📂 Output directories: \n  HTML: ${htmlDir}\n  Styles: ${stylesDir}\n  Pages: ${pagesDir}`);
  console.log(`🔧 Options: \n  Include computed styles: ${includeComputedStyles ? 'Yes' : 'No'}\n  Setup Tailwind CSS: ${setupTailwindCSS ? 'Yes' : 'No'}`);
  
  try {
    // Process the route using our modular processor (handles steps 1-5)
    const result = await processRoute(url, componentName, false, false, outputDir);
    
    // Get the component path from the processor result
    const jsxOutputPath = result.componentPath;
    
    // Log success message
    console.log(`\n🎉 Basic conversion process complete!`);
    
    // Handle any additional processing specific to html-to-react.js
    
    // Handle computed styles
    if (!includeComputedStyles) {
      console.log(`ℹ️ Skipping computed styles as per configuration`);
      // Optionally rename the file to make it clear it's not being used
      const computedCssPath = path.join(stylesDir, "computed.css");
      if (fs.existsSync(computedCssPath)) {
        fs.renameSync(computedCssPath, path.join(stylesDir, "computed.css.unused"));
        console.log(`ℹ️ Renamed computed.css to computed.css.unused`);
      }
    }
    
    // 6. Setup Tailwind CSS if requested
    if (setupTailwindCSS) {
      console.log(`\n🌬️ Setting up Tailwind CSS...`);
      setupTailwind();
      
      // Fix any CSS files that might use @layer directives
      console.log(`🔍 Checking CSS files for @layer directives...`);
      fixCssLayerDirectives(stylesDir);
      
      // Add Tailwind import to the component
      const componentPath = jsxOutputPath;
      let componentContent = fs.readFileSync(componentPath, 'utf8');
      
      // Add tailwind import if not already present
      if (!componentContent.includes('tailwind.css')) {
        componentContent = componentContent.replace(
          /import React from ['"]react['"];/,
          `import React from 'react';\nimport '../styles/tailwind.css';`
        );
        fs.writeFileSync(componentPath, componentContent);
        console.log(`✅ Added Tailwind CSS import to component`);
      }
    }
    
    console.log(`\n🎉 Conversion process complete!\n`);
    
    return {
      componentPath: jsxOutputPath,
      stylesDir,
      htmlPath: result.htmlPath
    };
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    throw error;
  }
}

/**
 * Discover routes from a starting URL and populate routes.json
 * @param {string} startUrl - The starting URL to discover routes from
 * @param {string} outputDir - The output directory to save routes.json
 * @returns {Promise<void>}
 */
async function discoverAndPopulateRoutes(startUrl, outputDir) {
  console.log(`🔍 Discovering routes from: ${startUrl}`);
  
  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });
  
  const routesFilePath = path.join(outputDir, 'routes.json');
  
  try {
    // Discover routes using the Puppeteer script
    const discoveredRoutes = await findFirstLevelRoutes(startUrl, routesFilePath);
    
    console.log(`✅ Discovered ${discoveredRoutes.length} routes and saved to routes.json`);
    return discoveredRoutes;
  } catch (error) {
    console.error(`❌ Error discovering routes: ${error.message}`);
    throw error;
  }
}

/**
 * Process multiple routes from a routes.json file
 * @param {string} outputDir - Directory containing the routes.json file and where output will be saved
 * @param {object} options - Additional options for processing
 * @returns {Promise<Array>} - Array of processed component results
 */
async function processRoutesFromJson(outputDir = path.resolve(__dirname, 'output'), options = {}) {
  const routesFilePath = path.join(outputDir, 'routes.json');
  
  if (!fs.existsSync(routesFilePath)) {
    console.error(`❌ routes.json not found in ${outputDir}`);
    throw new Error(`routes.json not found in ${outputDir}`);
  }
  
  try {
    // Read and parse routes.json
    const routesData = JSON.parse(fs.readFileSync(routesFilePath, 'utf8'));
    
    if (!Array.isArray(routesData) || routesData.length === 0) {
      console.error('❌ routes.json must contain a non-empty array of route objects');
      throw new Error('Invalid routes.json format');
    }
    
    console.log(`📋 Found ${routesData.length} routes in routes.json`);
    
    // Store createReactApp option and then disable it temporarily 
    // to prevent creating multiple React apps during route processing
    const shouldCreateReactApp = options.createReactApp;
    const tempOptions = { ...options, createReactApp: false };
    
    // Process each route
    const results = [];
    
    for (let i = 0; i < routesData.length; i++) {
      const route = routesData[i];
      
      if (!route.url || !route.componentName) {
        console.warn(`⚠️ Skipping invalid route at index ${i}: missing url or componentName`);
        continue;
      }
      
      console.log(`\n📄 Processing route ${i + 1}/${routesData.length}: ${route.url} => ${route.componentName}`);
      
      // Set options for this specific route
      const routeOptions = { ...tempOptions, componentName: route.componentName };
      
      try {
        const result = await convertToReactComponent(route.url, routeOptions);
        results.push(result);
      } catch (error) {
        console.error(`❌ Error processing route ${route.url}: ${error.message}`);
        // Continue with next route even if this one failed
      }
    }
    
    console.log(`\n✅ Processed ${results.length}/${routesData.length} routes successfully`);
    
    // Create a single React app with all components if requested
    if (shouldCreateReactApp && results.length > 0) {
      console.log(`\n📦 Creating a single React app with all ${results.length} components`);
      
      // Use the first component as the main one
      const mainComponentName = routesData[0].componentName;
      const reactAppName = options.reactAppName || mainComponentName.toLowerCase() + '-app';
      
      await createMultiComponentReactProject(results, mainComponentName, reactAppName, {
        stylesDir: path.join(outputDir, 'src/styles'),
        includeComputedStyles: options.includeComputedStyles,
        setupTailwindCSS: options.setupTailwindCSS
      });
    }
    
    return results;
  } catch (error) {
    console.error(`❌ Error processing routes: ${error.message}`);
    throw error;
  }
}

/**
 * Creates a complete React app with multiple extracted components
 * @param {Array} componentResults - Results from processing multiple routes
 * @param {string} mainComponentName - Name of the main component to use as the home page
 * @param {string} projectName - Name for the React project 
 * @param {object} options - Additional options for the React project
 */
async function createMultiComponentReactProject(componentResults, mainComponentName, projectName, options = {}) {
  const {
    stylesDir,
    includeComputedStyles = false,
    setupTailwindCSS = false
  } = options;
  
  const projectPath = path.join(process.cwd(), '..', projectName);
  
  console.log(`\n📦 Creating React app in ../${projectName} with multiple components...`);
  
  try {
    // Check if the project directory already exists
    if (fs.existsSync(projectPath)) {
      console.error(`\n⚠️ Directory ${projectPath} already exists.`);
      const userAnswer = await promptUser(`Do you want to overwrite the existing project? (y/n): `);
      
      if (userAnswer.toLowerCase() !== 'y') {
        console.log(`\n❌ React app creation aborted.`);
        return;
      }
    }
    
    // Create React app
    console.log(`\n⚙️ Running create-react-app...`);
    execSync(`npx create-react-app ${projectName}`, { 
      stdio: 'inherit', 
      cwd: path.join(process.cwd(), '..') 
    });
    console.log('✅ React app created');
    
    // Create pages directory (components will be organized by pages)
    fs.mkdirSync(path.join(projectPath, 'src', 'pages'), { recursive: true });
    
    // Process each component
    for (const result of componentResults) {
      const componentName = path.basename(result.componentPath, '.jsx');
      const pageDir = path.join(projectPath, 'src', 'pages', componentName);
      
      // Create page-specific directory
      fs.mkdirSync(pageDir, { recursive: true });
      
      // Create page-specific images and fonts directories
      fs.mkdirSync(path.join(pageDir, 'images-flat'), { recursive: true });
      fs.mkdirSync(path.join(pageDir, 'fonts-flat'), { recursive: true });
      
      // Read the component file
      let componentContent = fs.readFileSync(result.componentPath, 'utf8');
      
      // Copy the component to page directory as index.jsx
      const targetPath = path.join(pageDir, 'index.jsx');
      
      // Import paths are already correct since assets are in the same folder
      // No need to update paths - they should already be './images-flat/' and './' formats
      
      // Write updated component
      fs.writeFileSync(targetPath, componentContent);
      console.log(`✅ Component ${componentName} saved to: ${targetPath}`);
      
      // Source directory for this component in local output
      const sourcePageDir = path.join(__dirname, 'output', 'src', 'pages', componentName);
      
      // Copy component-specific CSS file (named after the component)
      const componentCssPath = path.join(sourcePageDir, `${componentName}.css`);
      if (fs.existsSync(componentCssPath)) {
        const targetCssPath = path.join(pageDir, `${componentName}.css`);
        
        // Read CSS content - paths should already be correct
        let cssContent = fs.readFileSync(componentCssPath, 'utf8');
        
        fs.writeFileSync(targetCssPath, cssContent);
        console.log(`✅ CSS file for ${componentName} copied to: ${targetCssPath}`);
      }
      
      // Copy ALL images to this page's images-flat folder
      const imagesDir = path.join(sourcePageDir, 'images-flat');
      if (fs.existsSync(imagesDir)) {
        const imageFiles = fs.readdirSync(imagesDir);
        imageFiles.forEach(file => {
          const sourcePath = path.join(imagesDir, file);
          const targetPath = path.join(pageDir, 'images-flat', file);
          if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, targetPath);
            console.log(`✅ Copied image: ${file} to ${componentName}/images-flat/`);
          }
        });
        console.log(`✅ Copied ${imageFiles.length} images to ${componentName}/images-flat/`);
      }
      
      // Copy ALL fonts to this page's fonts-flat folder
      const fontsDir = path.join(sourcePageDir, 'fonts-flat');
      if (fs.existsSync(fontsDir)) {
        const fontFiles = fs.readdirSync(fontsDir);
        fontFiles.forEach(file => {
          const sourcePath = path.join(fontsDir, file);
          const targetPath = path.join(pageDir, 'fonts-flat', file);
          if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, targetPath);
            console.log(`✅ Copied font: ${file} to ${componentName}/fonts-flat/`);
          }
        });
        console.log(`✅ Copied ${fontFiles.length} fonts to ${componentName}/fonts-flat/`);
      }
      
      // Copy App.css if it exists and is imported by this component
      if (componentContent.includes(`import './App.css'`)) {
        const appCssPath = path.join(sourcePageDir, 'App.css');
        if (fs.existsSync(appCssPath)) {
          const targetAppCssPath = path.join(pageDir, 'App.css');
          fs.copyFileSync(appCssPath, targetAppCssPath);
          console.log(`✅ Copied App.css to: ${targetAppCssPath}`);
        }
      }
      
      // Copy font-faces.css if it exists and is imported by this component
      if (componentContent.includes(`import './font-faces.css'`)) {
        const fontFacesCssPath = path.join(sourcePageDir, 'font-faces.css');
        if (fs.existsSync(fontFacesCssPath)) {
          const targetFontFacesCssPath = path.join(pageDir, 'font-faces.css');
          
          // Read CSS content - paths should already be correct
          let fontFacesContent = fs.readFileSync(fontFacesCssPath, 'utf8');
          
          fs.writeFileSync(targetFontFacesCssPath, fontFacesContent);
          console.log(`✅ Copied font-faces.css to: ${targetFontFacesCssPath}`);
        }
      }
      
      // Copy custom-vars.css if it exists and is imported by this component
      if (componentContent.includes(`import './custom-vars.css'`)) {
        const customVarsCssPath = path.join(sourcePageDir, 'custom-vars.css');
        if (fs.existsSync(customVarsCssPath)) {
          const targetCustomVarsCssPath = path.join(pageDir, 'custom-vars.css');
          fs.copyFileSync(customVarsCssPath, targetCustomVarsCssPath);
          console.log(`✅ Copied custom-vars.css to: ${targetCustomVarsCssPath}`);
        }
      }
    }
    
    // Create component list for navigation routes
    const componentNames = componentResults.map(result => 
      path.basename(result.componentPath, '.jsx')
    );
    
    // Update App.js to use React Router and page components
    const appJsPath = path.join(projectPath, 'src', 'App.js');
    const appJsContent = `import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
${componentNames.map(name => `import ${name} from './pages/${name}';`).join('\n')}

function App() {
  return (
    <BrowserRouter>
      <div className="App">
        <Routes>
          <Route path="/" element={<${mainComponentName} />} />
          ${componentNames.filter(name => name !== mainComponentName)
            .map(name => `<Route path="/${name.toLowerCase()}" element={<${name} />} />`)
            .join('\n          ')}
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
`;
    
    fs.writeFileSync(appJsPath, appJsContent);
    console.log(`✅ Updated App.js with React Router and all components`);
    
    // Configure Tailwind CSS if requested
    if (setupTailwindCSS) {
      console.log(`\n🌬️ Setting up Tailwind CSS in the React app...`);
      
      // Copy Tailwind config files from output directory
      const tailwindConfigFiles = [
        'tailwind.config.js',
        'postcss.config.js',
        'TAILWIND_SETUP.md'
      ];
      
      tailwindConfigFiles.forEach(file => {
        const sourcePath = path.join(__dirname, 'output', file);
        const targetPath = path.join(projectPath, file);
        
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, targetPath);
          console.log(`✅ Copied ${file} to React app`);
        }
      });
      
      // Create a shared tailwind.css file for the project
      const tailwindCssPath = path.join(projectPath, 'src', 'tailwind.css');
      const tailwindCssContent = `@tailwind base;
@tailwind components;
@tailwind utilities;`;
      fs.writeFileSync(tailwindCssPath, tailwindCssContent);
      console.log(`✅ Created tailwind.css in src directory`);
      
      // Add Tailwind import to index.js
      const indexJsPath = path.join(projectPath, 'src', 'index.js');
      if (fs.existsSync(indexJsPath)) {
        let indexContent = fs.readFileSync(indexJsPath, 'utf8');
        if (!indexContent.includes('./tailwind.css')) {
          indexContent = indexContent.replace(
            /import ['"]\.\/index\.css['"];/,
            `import './index.css';\nimport './tailwind.css';`
          );
          fs.writeFileSync(indexJsPath, indexContent);
          console.log(`✅ Added Tailwind CSS import to index.js`);
        }
      }
      
      // Update package.json to include Tailwind dependencies
      const packageJsonPath = path.join(projectPath, 'package.json');
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        
        // Add Tailwind dependencies
        if (!packageJson.devDependencies) {
          packageJson.devDependencies = {};
        }
        
        packageJson.devDependencies['tailwindcss'] = '^3.3.3';
        packageJson.devDependencies['autoprefixer'] = '^10.4.14';
        packageJson.devDependencies['postcss'] = '^8.4.27';
        
        // Write updated package.json
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        console.log('✅ Updated package.json with Tailwind dependencies');
      } catch (error) {
        console.error(`⚠️ Error updating package.json with Tailwind dependencies: ${error.message}`);
      }
    }
    
    // Update package.json to include React Router
    const packageJsonPath = path.join(projectPath, 'package.json');
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      // Add React Router dependencies
      packageJson.dependencies['react-router-dom'] = '^6.10.0';
      
      // Write updated package.json
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      console.log('✅ Updated package.json with React Router dependency');
    } catch (error) {
      console.error(`⚠️ Error updating package.json with React Router dependency: ${error.message}`);
    }
    
    // Run npm install to ensure all dependencies are installed
    console.log('\n⚙️ Running npm install to ensure all dependencies are installed...');
    execSync('npm install', { 
      stdio: 'inherit', 
      cwd: projectPath 
    });
    console.log('✅ Dependencies installed');
    
    console.log(`\n🎉 Multi-component React project created successfully! Here's how to run it:\n`);
    console.log(`cd ../${projectName}`);
    console.log(`npm start\n`);
    
  } catch (error) {
    console.error(`❌ Error creating React app: ${error.message}`);
    throw error;
  }
}

/**
 * Simple prompt function for user input
 */
function promptUser(question) {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    readline.question(question, answer => {
      readline.close();
      resolve(answer);
    });
  });
}

/**
 * Fix all image paths in CSS content to use the flat images directory
 * @param {string} cssContent - The CSS content to fix
 * @returns {string} - The fixed CSS content
 */
function fixImagePaths(cssContent) {
  // Fix any double images paths that might still exist
  cssContent = cssContent.replace(/url\(['"]?\.\.\/images\/images\/([^'"\)]+)['"]?\)/g, 
      `url('../styles/images-flat/$1')`);

  // Fix path with images-flat/images-flat pattern
  cssContent = cssContent.replace(/url\(['"]?\.\.\/images-flat\/images-flat\/([^'"\)]+)['"]?\)/g, 
      `url('../styles/images-flat/$1')`);

  // Convert all regular images paths to use images-flat
  cssContent = cssContent.replace(/url\(['"]?\.\.\/images\/([^'"\)]+)['"]?\)/g, 
      `url('../styles/images-flat/$1')`);
      
  // Fix relative paths to images-flat (standardize to ../styles/images-flat)
  cssContent = cssContent.replace(/url\(['"]?\.\.\/images-flat\/([^'"\)]+)['"]?\)/g, 
      `url('../styles/images-flat/$1')`);

  // Add multiple fallback paths for images in React environment - use only relative paths
  cssContent = cssContent.replace(/url\(['"]?\.\/images-flat\/([^'"\)]+)['"]?\)/g, 
      (match, imgFile) => `url('../styles/images-flat/${imgFile}')`);
      
  // Replace any absolute paths with relative ones
  cssContent = cssContent.replace(/url\(['"]?\/images-flat\/([^'"\)]+)['"]?\)/g,
      (match, imgFile) => `url('../styles/images-flat/${imgFile}')`);
      
  // Fix absolute paths to front/assets or similar
  cssContent = cssContent.replace(/url\(['"]?\/([^'"\)]+\.(svg|png|jpg|jpeg|gif|webp|avif))['"]?\)/gi,
      (match, path) => {
        const filename = path.split('/').pop();
        return `url('../styles/images-flat/${filename}')`;
      });
  
  return cssContent;
}

/**
 * Fix all font paths in CSS content to use the flat fonts directory
 * This handles all possible path patterns to ensure fonts are found
 * @param {string} cssContent - The CSS content to fix
 * @returns {string} - The fixed CSS content
 */
function fixFontPaths(cssContent) {
  // Handle front/assets/fonts paths
  cssContent = cssContent.replace(/url\(['"]?(\/front\/assets\/fonts\/[^'")\s]+)['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      // Use only relative paths to fonts-flat
      return `url('../styles/fonts-flat/${fontFile}')`;
    });
  
  // Handle /s/ paths (Google Fonts)
  cssContent = cssContent.replace(/url\(['"]?(\/s\/[^\/]+\/[^'")\s]+)['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('../styles/fonts-flat/${fontFile}')`;
    });
  
  // Handle ajax/libs paths (KaTeX)
  cssContent = cssContent.replace(/url\(['"]?(\/ajax\/libs\/[^'")\s]+)['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('../styles/fonts-flat/${fontFile}')`;
    });
  
  // Generic catch-all for any absolute paths to font files
  cssContent = cssContent.replace(/url\(['"]?(\/[^'")\s]+\.(woff2?|ttf|eot|otf|svg))['"]?\)/gi, 
    (match, fontPath) => {
      const fontFile = path.basename(fontPath);
      return `url('../styles/fonts-flat/${fontFile}')`;
    });
  
  // Handle relative paths that might be using the wrong directory level
  cssContent = cssContent.replace(/url\(['"]?(?:\.\.\/)+fonts-flat\/([^'")\s]+)['"]?\)/gi, 
    (match, fontFile) => {
      return `url('../styles/fonts-flat/${fontFile}')`;
    });
  
  // Replace any paths that mistakenly reference the old fonts directory
  cssContent = cssContent.replace(/url\(['"]?(?:\.\.\/)?fonts\/([^'")\s]+)['"]?\)/gi, 
    (match, fontFile) => {
      return `url('../styles/fonts-flat/${fontFile}')`;
    });
  
  // Fix paths with duplicate 'fonts/' segments
  cssContent = cssContent.replace(/url\(['"]?\.?\.?\/fonts-flat\/fonts\/([^'")\s]+)['"]?\)/gi, 
    (match, fontFile) => {
      return `url('../styles/fonts-flat/${fontFile}')`;
    });
  
  cssContent = cssContent.replace(/url\(['"]?\/fonts\/fonts\/([^'")\s]+)['"]?\)/gi, 
    (match, fontFile) => {
      return `url('../styles/fonts-flat/${fontFile}')`;
    });
  
  return cssContent;
}

// Run if called directly
if (require.main === module) {
  // Get URL and component name from command line
  const args = process.argv.slice(2);
  const url = args[0];
  const componentName = args[1] || 'ExtractedComponent';
  const createReactApp = args.includes('--create-app') || args.includes('-c');
  const includeComputedStyles = args.includes('--include-computed') || args.includes('-i');
  const setupTailwindCSS = args.includes('--tailwind') || args.includes('-t');
  const reactAppName = args.find((arg, i) => 
    (arg === '--app-name' || arg === '-a') && i + 1 < args.length
  ) ? args[args.findIndex(arg => arg === '--app-name' || arg === '-a') + 1] : componentName.toLowerCase() + '-app';
  const outputDir = path.resolve(__dirname, 'output');
  
  // Check if routes.json exists
  const routesFilePath = path.join(outputDir, 'routes.json');
  const hasRoutesFile = fs.existsSync(routesFilePath);
  
  // Options to pass to the conversion functions
  const options = { 
    componentName, 
    createReactApp, 
    reactAppName, 
    includeComputedStyles, 
    setupTailwindCSS,
    outputDir
  };

  // If URL is provided, always discover routes first, then process them
  if (url) {
    console.log('🔄 Starting automated workflow with route discovery');
    
    // First, discover routes and populate routes.json
    discoverAndPopulateRoutes(url, outputDir)
      .then(() => {
        // Then process all discovered routes
        console.log('🔄 Processing discovered routes');
        return processRoutesFromJson(outputDir, options);
      })
      .then(() => console.log('✨ All routes processed successfully!'))
      .catch(err => {
        console.error('❌ Error:', err);
        process.exit(1);
      });
  } else if (hasRoutesFile) {
    // Fallback: if no URL provided but routes.json exists, process existing routes
    console.log('🔄 Processing existing routes from routes.json (no URL provided)');
    processRoutesFromJson(outputDir, options)
      .then(() => console.log('✨ All routes processed successfully!'))
      .catch(err => {
        console.error('❌ Error:', err);
        process.exit(1);
      });
  } else {
    console.error('❌ Error: No URL provided and no routes.json found in output directory');
    console.error('Usage: node html-to-react.js <url> [component-name] [--create-app/-c] [--app-name/-a app-name] [--include-computed/-i] [--tailwind/-t]');
    console.error('   OR: node html-to-react.js (with existing routes.json in output directory)');
    console.error('Example: node html-to-react.js https://example.com MyComponent --create-app --app-name my-react-app --tailwind');
    process.exit(1);
  }
}

module.exports = {
  convertToReactComponent,
  processRoutesFromJson,
  discoverAndPopulateRoutes
}; 