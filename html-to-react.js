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
const extractRenderedHTML = require('./src/extractors/extractHTMLWithPuppeteer');
const extractStylesWithPuppeteer = require('./src/extractors/extractStylesWithPuppeteer');
const { convertHTMLtoJSX, generateCSSFromVars, cssVarMap, getImageImports, setSanitizedFilenameMap } = require('./src/converters/convertHTMLtoJSX');
const { setupTailwind, fixCssLayerDirectives } = require('./scripts/setupTailwind');
const { extractImages } = require('./src/extractors/extractImages');

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
    setupTailwindCSS = false
  } = options;

  console.log(`🚀 Starting conversion process for: ${url}`);
  console.log(`📂 Output directories: \n  HTML: ${htmlDir}\n  Styles: ${stylesDir}\n  Pages: ${pagesDir}`);
  console.log(`🔧 Options: \n  Include computed styles: ${includeComputedStyles ? 'Yes' : 'No'}\n  Setup Tailwind CSS: ${setupTailwindCSS ? 'Yes' : 'No'}`);
  
  try {
    // Create output directories
    fs.mkdirSync(htmlDir, { recursive: true });
    fs.mkdirSync(stylesDir, { recursive: true });
    fs.mkdirSync(componentsDir, { recursive: true });
    fs.mkdirSync(pagesDir, { recursive: true }); // Create pages directory

    // 1. Extract HTML
    const htmlOutputPath = path.join(htmlDir, `${componentName}.html`);
    console.log(`\n📄 Extracting rendered HTML...`);
    const renderedHTML = await extractRenderedHTML(url, htmlOutputPath);
    
    // 2. Extract CSS
    console.log(`\n🎨 Extracting CSS styles...`);
    const extractedStyles = await extractStylesWithPuppeteer(url, stylesDir);
    
    // 2b. Extract and download images 
    console.log(`\n🖼️ Extracting and downloading images...`);
    const { processedImages, updatedHtml, imageMap } = await extractImages(
      renderedHTML, 
      extractedStyles.cssFiles, 
      url, 
      stylesDir
    );
    
    // Pass the sanitized filename mapping to the JSX converter
    setSanitizedFilenameMap(imageMap);
    
    // 3. Convert to JSX
    const jsxOutputPath = path.join(pagesDir, `${componentName}.jsx`); // Save to pages directory
    console.log(`\n⚛️ Converting HTML to JSX...`);
    
    // Convert HTML to JSX using your converter - use the updated HTML with image paths
    const jsxContent = convertHTMLtoJSX(updatedHtml || renderedHTML);
    
    // Get image imports generated during conversion
    const imageImports = getImageImports();
    
    // 4. Create a complete React component with style imports
    const styleImports = [];
    
    // Add font-faces CSS first (if it exists) to ensure fonts are defined before use
    const fontFacesCssPath = path.join(stylesDir, "font-faces.css");
    if (fs.existsSync(fontFacesCssPath)) {
      styleImports.push(`import '../styles/font-faces.css';`);
      console.log(`✅ Adding font-faces.css import`);
    }
    
    // Add imports for inline and computed styles
    const inlineCssPath = path.join(stylesDir, "App.css");
    if (fs.existsSync(inlineCssPath)) {
      styleImports.push(`import '../styles/App.css';`);
    }
    
    // Only include computed styles if explicitly requested
    if (includeComputedStyles) {
      const computedCssPath = path.join(stylesDir, "computed.css");
      if (fs.existsSync(computedCssPath)) {
        styleImports.push(`import '../styles/computed.css';`);
      }
    } else {
      console.log(`ℹ️ Skipping computed styles as per configuration`);
      // Optionally rename the file to make it clear it's not being used
      const computedCssPath = path.join(stylesDir, "computed.css");
      if (fs.existsSync(computedCssPath)) {
        fs.renameSync(computedCssPath, path.join(stylesDir, "computed.css.unused"));
        console.log(`ℹ️ Renamed computed.css to computed.css.unused`);
      }
    }
    
    // Add imports for external stylesheets
    if (fs.existsSync(stylesDir)) {
      const externalStyleFiles = fs.readdirSync(stylesDir)
        .filter(file => file.endsWith('.css') && 
          file !== 'App.css' && 
          file !== 'computed.css' && 
          file !== 'computed.css.unused' &&
          file !== 'font-faces.css');
      
      externalStyleFiles.forEach(file => {
        styleImports.push(`import '../styles/${file}';`);
      });
    }
    
    // 5. Generate CSS for custom variables if needed
    if (Object.keys(cssVarMap).length > 0) {
      const customVarsCss = generateCSSFromVars(cssVarMap);
      const customCssPath = path.join(stylesDir, "custom-vars.css");
      fs.writeFileSync(customCssPath, customVarsCss);
      styleImports.push(`import '../styles/custom-vars.css';`);
      console.log(`✅ Saved custom CSS variables to custom-vars.css`);
    }
    
    // 6. Setup Tailwind CSS if requested
    if (setupTailwindCSS) {
      console.log(`\n🌬️ Setting up Tailwind CSS...`);
      setupTailwind();
      
      // Fix any CSS files that might use @layer directives
      console.log(`🔍 Checking CSS files for @layer directives...`);
      fixCssLayerDirectives(stylesDir);
      
      // Add Tailwind import to the component
      styleImports.unshift(`import '../styles/tailwind.css';`);
      console.log(`✅ Added Tailwind CSS import to component`);
    }
    
    // Add image imports at the start of the component
    const componentCode = `
import React from 'react';
${imageImports ? imageImports + '\n' : ''}${styleImports.join('\n')}

export default function ${componentName}() {
  return (
${jsxContent}
  );
}
`;
    
    fs.writeFileSync(jsxOutputPath, componentCode);
    console.log(`✅ React component saved to: ${jsxOutputPath}`);
    
    // 7. Log information about image imports
    if (imageImports) {
      const imageImportCount = imageImports.split('\n').length;
      console.log(`✅ Added ${imageImportCount} image import${imageImportCount !== 1 ? 's' : ''} for Webpack bundling`);
    }
    
    console.log(`\n🎉 Conversion process complete!\n`);
    
    // 8. Create a React app if requested
    if (createReactApp) {
      await createReactProject(componentName, reactAppName, {
        componentPath: jsxOutputPath,
        stylesDir,
        styleImports,
        includeComputedStyles,
        setupTailwindCSS
      });
    }
    
    return {
      componentPath: jsxOutputPath,
      stylesDir,
      htmlPath: htmlOutputPath
    };
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    throw error;
  }
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
 * Creates a complete React app with the extracted component
 */
async function createReactProject(componentName, projectName, options = {}) {
  const {
    componentPath,
    stylesDir,
    styleImports,
    includeComputedStyles = false,
    setupTailwindCSS = false
  } = options;
  
  const projectPath = path.join(process.cwd(), '..', projectName);
  
  console.log(`\n📦 Creating React app in ../${projectName}...`);
  
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
    
    // Create component and pages directories
    fs.mkdirSync(path.join(projectPath, 'src', 'components'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'src', 'pages'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'src', 'styles'), { recursive: true });
    
    // Copy the component to pages directory
    fs.copyFileSync(
      componentPath,
      path.join(projectPath, 'src', 'pages', `${componentName}.jsx`)
    );
    console.log(`✅ Component ${componentName}.jsx copied to project pages directory`);
    
    // Copy CSS files
    const cssFiles = fs.readdirSync(stylesDir)
      .filter(file => {
        // Skip the computed.css file if includeComputedStyles is false
        if (file === 'computed.css' && !includeComputedStyles) return false;
        if (file === 'computed.css.unused') return false;
        return file.endsWith('.css');
      });
      
    cssFiles.forEach(file => {
      const sourcePath = path.join(stylesDir, file);
      const targetPath = path.join(projectPath, 'src', 'styles', file);
      
      // First copy the file
      fs.copyFileSync(sourcePath, targetPath);
      
      // Then fix any paths in the CSS
      let cssContent = fs.readFileSync(targetPath, 'utf8');
      
      // Fix image paths
      cssContent = fixImagePaths(cssContent);
      
      // Fix font paths
      cssContent = fixFontPaths(cssContent);
      
      // Write back the fixed CSS
      fs.writeFileSync(targetPath, cssContent);
      console.log(`✅ Copied and fixed paths in ${file}`);
    });
    
    // Copy fonts and images directories if they exist
    const fontsDir = path.join(__dirname, 'output', 'src/styles', 'fonts-flat');
    const imagesDir = path.join(__dirname, 'output', 'src/styles', 'images-flat');
    const targetFontsDir = path.join(projectPath, 'src', 'styles', 'fonts-flat');
    const targetImagesDir = path.join(projectPath, 'src', 'styles', 'images-flat');
    
    if (fs.existsSync(fontsDir)) {
      fs.mkdirSync(targetFontsDir, { recursive: true });
      
      fs.readdirSync(fontsDir).forEach(file => {
        fs.copyFileSync(
          path.join(fontsDir, file),
          path.join(targetFontsDir, file)
        );
      });
      
      console.log(`✅ Copied fonts directory`);
    }
    
    if (fs.existsSync(imagesDir)) {
      fs.mkdirSync(targetImagesDir, { recursive: true });
      
      fs.readdirSync(imagesDir).forEach(file => {
        fs.copyFileSync(
          path.join(imagesDir, file),
          path.join(targetImagesDir, file)
        );
      });
      
      console.log(`✅ Copied images directory`);
    }
    
    // Update App.js to use the component from pages directory
    const appJsPath = path.join(projectPath, 'src', 'App.js');
    const appJsContent = `import React from 'react';
import ${componentName} from './pages/${componentName}';

function App() {
  return (
    <div className="App">
      <${componentName} />
    </div>
  );
}

export default App;
`;
    
    fs.writeFileSync(appJsPath, appJsContent);
    console.log(`✅ Updated App.js to use the ${componentName} component`);
    
    // Configure Tailwind CSS if requested
    if (setupTailwindCSS) {
      console.log(`\n🌬️ Setting up Tailwind CSS in the React app...`);
      
      // Copy Tailwind config files from output directory
      const tailwindConfigFiles = [
        'tailwind.config.js',
        'postcss.config.js',
        'src/styles/tailwind.css',
        'TAILWIND_SETUP.md'
      ];
      
      tailwindConfigFiles.forEach(file => {
        const sourcePath = path.join(__dirname, 'output', file);
        const targetPath = path.join(projectPath, file.startsWith('styles/') ? 
          path.join('src', file) : file);
        
        // Create directory if needed
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, targetPath);
          console.log(`✅ Copied ${file} to React app`);
        }
      });
      
      // Copy DarkModeToggle component
      const darkModeTogglePath = path.join(__dirname, 'output', 'src/components', 'DarkModeToggle.jsx');
      if (fs.existsSync(darkModeTogglePath)) {
        fs.copyFileSync(
          darkModeTogglePath,
          path.join(projectPath, 'src', 'components', 'DarkModeToggle.jsx')
        );
        console.log(`✅ Copied DarkModeToggle component to React app`);
      }
      
      // Fix any CSS files that might use @layer directives
      const reactStylesDir = path.join(projectPath, 'src', 'styles');
      if (fs.existsSync(reactStylesDir)) {
        console.log(`🔍 Checking CSS files for @layer directives...`);
        fixCssLayerDirectives(reactStylesDir);
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
        
        // Update App.js to include DarkModeToggle if it exists
        if (fs.existsSync(path.join(projectPath, 'src', 'components', 'DarkModeToggle.jsx'))) {
          const appJsContent = `import React from 'react';
import ${componentName} from './pages/${componentName}';
import DarkModeToggle from './components/DarkModeToggle';
import './styles/tailwind.css';

function App() {
  return (
    <div className="App">
      <DarkModeToggle />
      <${componentName} />
    </div>
  );
}

export default App;
`;
          fs.writeFileSync(appJsPath, appJsContent);
          console.log(`✅ Updated App.js to include DarkModeToggle component`);
        }
      } catch (error) {
        console.error(`⚠️ Error updating package.json with Tailwind dependencies: ${error.message}`);
      }
    }
    
    // Create webpack.config.js to handle font and image files correctly
    const webpackConfigPath = path.join(projectPath, 'webpack.config.js');
    const webpackContent = `
module.exports = {
  module: {
    rules: [
      {
        test: /\\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
      {
        test: /\\.(png|jpg|jpeg|gif|svg|webp)$/i,
        type: 'asset/resource',
      }
    ],
  },
};
`;
    fs.writeFileSync(webpackConfigPath, webpackContent);
    console.log(`✅ Created webpack.config.js with font and image handling rules`);
      
    // Create .env file to tell CRA to treat certain files as static assets
    const envPath = path.join(projectPath, '.env');
    const envContent = `
# Tell Create React App to handle font files as static assets
GENERATE_SOURCEMAP=false
INLINE_RUNTIME_CHUNK=false
# Allow importing from outside of src/
EXTEND_ESLINT=true
# Add public URL for production build
PUBLIC_URL=.
# Skip preflight check to avoid conflicts with custom webpack config
SKIP_PREFLIGHT_CHECK=true
# Ensure fonts are treated properly
REACT_APP_FONTS_PATH=./fonts-flat
# Ensure images are treated properly
REACT_APP_IMAGES_PATH=./images-flat
`;
    fs.writeFileSync(envPath, envContent);
    console.log(`✅ Created .env file for better font and image handling`);
      
    // Create a custom index.html with preloaded fonts
    const indexHtmlPath = path.join(projectPath, 'public', 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      try {
        let indexContent = fs.readFileSync(indexHtmlPath, 'utf8');
        
        // Add preload links for fonts
        const flatFontsDir = path.join(stylesDir, 'fonts-flat');
        const fontFiles = fs.existsSync(flatFontsDir) ? fs.readdirSync(flatFontsDir).filter(file => file.endsWith('.woff') || file.endsWith('.woff2')) : [];
        const fontPreloads = fontFiles
          .map(file => {
            const type = file.endsWith('.woff') ? 'font/woff' : 'font/woff2';
            return `    <link rel="preload" href="%PUBLIC_URL%/fonts-flat/${file}" as="font" type="${type}" crossorigin>`;
          })
          .join('\n');
          
        // Insert preload links before the closing head tag
        indexContent = indexContent.replace('</head>', `\n${fontPreloads}\n  </head>`);
        
        fs.writeFileSync(indexHtmlPath, indexContent);
        console.log(`✅ Updated index.html with font preload links`);
      } catch (err) {
        console.warn(`⚠️ Could not update index.html: ${err.message}`);
      }
    }
    
    try {
      // Create a special font-loader.css file with multiple fallback methods
      const fontLoaderCssPath = path.join(projectPath, 'src', 'styles', 'font-loader.css');
      let fontLoaderContent = '/* Font loader with multiple fallback strategies */\n\n';
      
      const flatFontsDir = path.join(stylesDir, 'fonts-flat');
      // Get all WOFF and WOFF2 files
      const fontFiles = fs.existsSync(flatFontsDir) ? fs.readdirSync(flatFontsDir).filter(file => file.endsWith('.woff') || file.endsWith('.woff2')) : [];
      
      // Group by font name (without extension and hash)
      const fontGroups = {};
      fontFiles.forEach(file => {
        // Try to extract font name by removing extension and hash
        const baseName = file.split('.')[0].split('-')[0];
        if (!fontGroups[baseName]) {
          fontGroups[baseName] = [];
        }
        fontGroups[baseName].push(file);
      });
      
      // Create font-face declarations for each font using multiple sources
      Object.keys(fontGroups).forEach(fontName => {
        const fontFiles = fontGroups[fontName];
        
        fontLoaderContent += `@font-face {\n`;
        fontLoaderContent += `  font-family: '${fontName}';\n`;
        fontLoaderContent += `  src: \n`;
        
        // Add all variants of the font
        const srcs = fontFiles.map(file => {
          const format = file.endsWith('.woff') ? 'woff' : 'woff2';
          return `    url('./fonts-flat/${file}') format('${format}')`; 
        });
        
        fontLoaderContent += srcs.join(',\n') + ';\n';
        fontLoaderContent += `  font-weight: normal;\n`;
        fontLoaderContent += `  font-style: normal;\n`;
        fontLoaderContent += `  font-display: swap;\n`;
        fontLoaderContent += `}\n\n`;
      });
      
      fs.writeFileSync(fontLoaderCssPath, fontLoaderContent);
      console.log(`✅ Created font-loader.css with ${Object.keys(fontGroups).length} font families`);
      
      // Add an import for font-loader.css to the main component
      const componentPath = path.join(projectPath, 'src', 'pages', `${componentName}.jsx`);
      if (fs.existsSync(componentPath)) {
        let componentContent = fs.readFileSync(componentPath, 'utf8');
        
        // Add font-loader import if not already there
        if (!componentContent.includes('font-loader.css')) {
          componentContent = componentContent.replace(
            /import React from ['"]react['"];/,
            `import React from 'react';\nimport '../styles/font-loader.css';`
          );
          fs.writeFileSync(componentPath, componentContent);
          console.log(`✅ Added font-loader.css import to ${componentName}.jsx`);
        }
      }
    } catch (err) {
      console.warn(`⚠️ Could not create font-loader.css: ${err.message}`);
    }
    
    // Verify all necessary files exist for the React app to run
    const requiredFiles = [
      path.join(projectPath, 'src', 'App.js'),
      path.join(projectPath, 'src', 'index.js'),
      path.join(projectPath, 'public', 'index.html'),
      path.join(projectPath, 'package.json')
    ];
    
    const missingFiles = requiredFiles.filter(file => !fs.existsSync(file));
    
    if (missingFiles.length > 0) {
      console.error('⚠️ Some required files are missing:');
      missingFiles.forEach(file => console.error(`  - ${file}`));
      
      // Create index.js if it's missing
      if (missingFiles.includes(path.join(projectPath, 'src', 'index.js'))) {
        const indexJsContent = `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
        fs.writeFileSync(path.join(projectPath, 'src', 'index.js'), indexJsContent);
        console.log('✅ Created missing src/index.js file');
      }
      
      // Create index.css if it's missing
      if (!fs.existsSync(path.join(projectPath, 'src', 'index.css'))) {
        const indexCssContent = `body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

code {
  font-family: source-code-pro, Menlo, Monaco, Consolas, 'Courier New',
    monospace;
}
`;
        fs.writeFileSync(path.join(projectPath, 'src', 'index.css'), indexCssContent);
        console.log('✅ Created missing src/index.css file');
      }
    }
    
    // Run npm install to ensure all dependencies are installed
    console.log('\n⚙️ Running npm install to ensure all dependencies are installed...');
    execSync('npm install', { 
      stdio: 'inherit', 
      cwd: projectPath 
    });
    console.log('✅ Dependencies installed');
    
    console.log(`\n🎉 React project created successfully! Here's how to run it:\n`);
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
  
  if (!url) {
    console.error('❌ Usage: node html-to-react.js <url> [component-name] [--create-app/-c] [--app-name/-a app-name] [--include-computed/-i] [--tailwind/-t]');
    console.error('Example: node html-to-react.js https://example.com MyComponent --create-app --app-name my-react-app --tailwind');
    process.exit(1);
  }

  convertToReactComponent(url, { componentName, createReactApp, reactAppName, includeComputedStyles, setupTailwindCSS })
    .then(() => console.log('✨ Done!'))
    .catch(err => {
      console.error('❌ Error:', err);
      process.exit(1);
    });
}

module.exports = convertToReactComponent; 