const fs = require('fs');
const path = require('path');

/**
 * Creates a Tailwind configuration for the generated React project
 */
function setupTailwindConfig() {
  const outputDir = path.join(__dirname, '../output');
  
  // Create tailwind.config.js
  const tailwindConfig = `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
  darkMode: 'class', // or 'media' if you prefer system preference
}`;

  // Create postcss.config.js
  const postcssConfig = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`;

  // Create main CSS file with Tailwind directives
  const tailwindCSS = `@tailwind base;
@tailwind components;
@tailwind utilities;

/* Your custom styles below */
`;

  // Write files to output directory
  try {
    fs.writeFileSync(path.join(outputDir, 'tailwind.config.js'), tailwindConfig);
    fs.writeFileSync(path.join(outputDir, 'postcss.config.js'), postcssConfig);
    
    // Create styles directory if it doesn't exist
    const stylesDir = path.join(outputDir, 'src/styles');
    if (!fs.existsSync(stylesDir)) {
      fs.mkdirSync(stylesDir, { recursive: true });
    }
    
    // Write tailwind.css file
    fs.writeFileSync(path.join(stylesDir, 'tailwind.css'), tailwindCSS);
    
    console.log('✅ Tailwind CSS configuration files created successfully!');
    
    // Fix any existing CSS files that might use @layer directives
    fixCssLayerDirectives(stylesDir);
    
    // Create a README with instructions
    const readmeContent = `# Tailwind CSS Setup

This project uses Tailwind CSS for styling.

## Installation

To use Tailwind CSS in this project, install the required dependencies:

\`\`\`
npm install tailwindcss postcss autoprefixer
\`\`\`

## Usage

The Tailwind configuration files have been set up for you:

- \`tailwind.config.js\` - Main Tailwind configuration
- \`postcss.config.js\` - PostCSS configuration for Tailwind
- \`src/styles/tailwind.css\` - Main CSS file with Tailwind directives

Import the \`tailwind.css\` file in your main component or entry file:

\`\`\`jsx
// In src/index.js or src/App.js
import './styles/tailwind.css';
\`\`\`

## Dark Mode

Dark mode is configured to use the 'class' strategy. To enable dark mode:

\`\`\`jsx
// Add the 'dark' class to your HTML or root element
document.documentElement.classList.add('dark');
\`\`\`

## Learn More

- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Dark Mode in Tailwind CSS](https://tailwindcss.com/docs/dark-mode)
`;
    
    fs.writeFileSync(path.join(outputDir, 'TAILWIND_SETUP.md'), readmeContent);
    
    return true;
  } catch (error) {
    console.error('❌ Error setting up Tailwind CSS configuration:', error);
    return false;
  }
}

/**
 * Fixes CSS files that use @layer directives without Tailwind imports
 * @param {string} stylesDir - Directory containing CSS files
 */
function fixCssLayerDirectives(stylesDir) {
  if (!fs.existsSync(stylesDir)) return;
  
  const cssFiles = fs.readdirSync(stylesDir).filter(file => 
    file.endsWith('.css') && file !== 'tailwind.css'
  );
  
  let modifiedFiles = 0;
  
  cssFiles.forEach(file => {
    const filePath = path.join(stylesDir, file);
    try {
      let content = fs.readFileSync(filePath, 'utf8');
      let modified = false;
      
      // Check if file uses @layer directives
      if (content.includes('@layer') && !content.includes('@tailwind')) {
        console.log(`🔧 Fixing @layer directives in ${file}...`);
        
        // Add Tailwind directives at the top if they're missing
        content = `@tailwind base;
@tailwind components;
@tailwind utilities;

/* Original CSS content below */
${content}`;
        
        modified = true;
      }
      
      // Special fix for style.css which might have the error
      if (file === 'style.css') {
        console.log(`🔧 Applying special fix for style.css...`);
        
        // Check if it's already fixed
        if (!content.includes('@tailwind base')) {
          // Add Tailwind directives at the top
          content = `@tailwind base;
@tailwind components;
@tailwind utilities;

/* Original style.css content below */
${content}`;
          
          modified = true;
        }
        
        // Additional fixes for common style.css issues
        
        // Fix 1: Remove duplicate @layer directives that might conflict with Tailwind
        const layerRegex = /@layer\s+(base|components|utilities)\s*{([^}]*)}/g;
        const matches = [...content.matchAll(layerRegex)];
        
        if (matches.length > 0) {
          console.log(`🔧 Found ${matches.length} @layer directives that might conflict with Tailwind`);
          
          // Extract the content from each @layer and move it outside the layer
          matches.forEach(match => {
            const layerType = match[1]; // base, components, or utilities
            const layerContent = match[2]; // content inside the layer
            
            // Replace the @layer with just its content
            content = content.replace(match[0], `/* Extracted from @layer ${layerType} */\n${layerContent}\n`);
          });
          
          modified = true;
        }
      }
      
      if (modified) {
        fs.writeFileSync(filePath, content);
        modifiedFiles++;
      }
    } catch (error) {
      console.error(`❌ Error fixing CSS file ${file}:`, error);
    }
  });
  
  if (modifiedFiles > 0) {
    console.log(`✅ Fixed @layer directives in ${modifiedFiles} CSS files`);
  }
}

// Create package.json for the output project
function createPackageJson() {
  const outputDir = path.join(__dirname, '../output');
  
  const packageJson = {
    name: "web-to-react-output",
    version: "1.0.0",
    description: "Generated React project from HTML",
    scripts: {
      "dev": "next dev",
      "build": "next build",
      "start": "next start"
    },
    dependencies: {
      "react": "^18.2.0",
      "react-dom": "^18.2.0",
      "next": "^13.4.19"
    },
    devDependencies: {
      "autoprefixer": "^10.4.14",
      "postcss": "^8.4.27",
      "tailwindcss": "^3.3.3"
    }
  };
  
  try {
    fs.writeFileSync(
      path.join(outputDir, 'package.json'), 
      JSON.stringify(packageJson, null, 2)
    );
    console.log('✅ package.json created successfully!');
    return true;
  } catch (error) {
    console.error('❌ Error creating package.json:', error);
    return false;
  }
}

// Create a simple dark mode toggle component
function createDarkModeToggle() {
  const outputDir = path.join(__dirname, '../output');
  const componentsDir = path.join(outputDir, 'src/components');
  
  // Create components directory if it doesn't exist
  if (!fs.existsSync(componentsDir)) {
    fs.mkdirSync(componentsDir, { recursive: true });
  }
  
  const darkModeToggle = `import { useState, useEffect } from 'react';

export default function DarkModeToggle() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  
  // Initialize dark mode based on system preference or localStorage
  useEffect(() => {
    // Check localStorage first
    const savedMode = localStorage.getItem('darkMode');
    if (savedMode !== null) {
      setIsDarkMode(savedMode === 'true');
    } else {
      // Fall back to system preference
      setIsDarkMode(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
  }, []);
  
  // Update when the state changes
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', isDarkMode);
  }, [isDarkMode]);
  
  return (
    <button
      onClick={() => setIsDarkMode(!isDarkMode)}
      className="fixed top-4 right-4 z-50 p-2 bg-gray-200 dark:bg-gray-800 rounded-full"
      aria-label="Toggle dark mode"
    >
      {isDarkMode ? '☀️' : '🌙'}
    </button>
  );
}
`;
  
  try {
    fs.writeFileSync(path.join(componentsDir, 'DarkModeToggle.jsx'), darkModeToggle);
    console.log('✅ DarkModeToggle component created successfully!');
    return true;
  } catch (error) {
    console.error('❌ Error creating DarkModeToggle component:', error);
    return false;
  }
}

// Run all setup functions
function setupTailwind() {
  console.log('🚀 Setting up Tailwind CSS for the generated React project...');
  
  const tailwindSetup = setupTailwindConfig();
  const packageJsonCreated = createPackageJson();
  const darkModeToggleCreated = createDarkModeToggle();
  
  // Fix CSS files in the src/styles directory
  const outputDir = path.join(__dirname, '../output');
  const stylesDir = path.join(outputDir, 'src/styles');
  fixCssLayerDirectives(stylesDir);
  
  if (tailwindSetup && packageJsonCreated && darkModeToggleCreated) {
    console.log('✅ Tailwind CSS setup complete!');
    console.log('📝 See TAILWIND_SETUP.md for usage instructions.');
  } else {
    console.error('❌ Tailwind CSS setup failed.');
  }
}

// Execute if run directly
if (require.main === module) {
  setupTailwind();
}

module.exports = { setupTailwind, fixCssLayerDirectives }; 