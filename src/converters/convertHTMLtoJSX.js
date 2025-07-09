const cheerio = require("htmlparser2");

/**
 * Maps HTML attributes to their React (JSX) equivalents.
 */
const attributeRenameMap = {
  class: "className",
  for: "htmlFor",
  readonly: "readOnly",
  maxlength: "maxLength",
  tabindex: "tabIndex",
  colspan: "colSpan",
  rowspan: "rowSpan",
  contenteditable: "contentEditable",
  autocomplete: "autoComplete",
  autofocus: "autoFocus",
  autoplay: "autoPlay",
  srcset: "srcSet",
  crossorigin: "crossOrigin",
  enctype: "encType",
  novalidate: "noValidate",
  usemap: "useMap",
  // Adding SVG specific attributes
  viewbox: "viewBox", 
  preserveaspectratio: "preserveAspectRatio",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
  "fill-opacity": "fillOpacity",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-opacity": "strokeOpacity",
  // Add other common attributes
  spellcheck: "spellCheck",
  datetime: "dateTime",
  acceptcharset: "acceptCharset",
  allowfullscreen: "allowFullScreen",
  inputmode: "inputMode",
  hreflang: "hrefLang",
  referrerpolicy: "referrerPolicy"
};

/**
 * Set of boolean attributes that should be rendered as JSX booleans.
 */
const booleanAttributes = new Set([
  "disabled", "checked", "readonly", "required",
  "autofocus", "selected", "multiple", "novalidate",
  "allowfullscreen", "autoplay", "controls", "loop",
  "muted", "playsinline", "default", "ismap",
  "reversed", "async", "defer", "nomodule",
  "spellcheck", "autocomplete", "translate", "contenteditable"
]);

/**
 * HTML tags that are self-closing.
 */
const selfClosingTags = new Set([
  "area", "base", "br", "col", "embed",
  "hr", "img", "input", "keygen", "link",
  "meta", "param", "source", "track", "wbr"
]);

/**
 * Converts HTML event names (e.g., onclick) to JSX camelCase format (e.g., onClick).
 * @param {string} attr - The attribute name
 * @returns {string} - The JSX-style event name
 */
function toJSXEventName(attr) {
  return attr.replace(/^on([a-z])/, (_, c) => `on${c.toUpperCase()}`);
}

/**
 * Converts an inline style string to a JSX-compatible style object string,
 * separating regular styles from CSS custom properties.
 * @param {string} styleString - The raw style string from the HTML attribute
 * @returns {{styleString: string, cssVars: Object}} - JSX style string and CSS variable map
 */
function convertStyle(styleString) {
  const jsStyles = [];
  const cssVars = {};

  styleString.split(";").forEach(decl => {
    const [propRaw, valueRaw] = decl.split(":");
    if (!propRaw || !valueRaw) return;

    const prop = propRaw.trim();
    const value = valueRaw.trim();
    if (!prop || !value) return;

    if (prop.startsWith("--")) {
      cssVars[prop] = value;
    } else {
      const jsProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      // Handle url() values with proper quote escaping
      if (value.includes('url(') && value.includes("'")) {
        // Use double quotes for the outer wrapper when value contains single quotes
        jsStyles.push(`${jsProp}: "${value}"`);
      } else {
        jsStyles.push(`${jsProp}: '${value}'`);
      }
    }
  });

  return {
    styleString: jsStyles.length > 0 ? `{{ ${jsStyles.join(", ")} }}` : null,
    cssVars
  };
}

let customClassCounter = 0;
const cssVarMap = {};

/**
 * Check if a value represents a boolean
 * @param {string} value - The attribute value
 * @returns {boolean} - Whether it's a boolean value
 */
function isBooleanValue(value) {
  const lower = String(value).toLowerCase();
  return lower === 'true' || lower === 'false' || lower === '';
}

// Replace the Set with a Map to track image imports
let imageImportsMap = new Map();
// Store mapping from original URLs to sanitized filenames from extractImages.js
let sanitizedFilenameMap = {};

/**
 * Convert absolute paths to import variables for HTML image sources
 * @param {string} src - The source attribute value
 * @returns {string} - Either an import variable reference or the original src
 */
function fixHtmlImagePath(src) {
  if (!src) return src;
  
  // Skip data URLs and external URLs
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }
  
  // If we have a sanitized filename map and this path is in it, use the sanitized name
  if (sanitizedFilenameMap && 
      (sanitizedFilenameMap[src] || 
       (src.startsWith('/') && sanitizedFilenameMap[src.substring(1)]))) {
    
    // Get sanitized filename (try with and without leading slash)
    const sanitizedFilename = sanitizedFilenameMap[src] || sanitizedFilenameMap[src.substring(1)];
    
    // Create import variable for ALL images (SVGs and PNGs)
    if (/\.(svg|png|jpg|jpeg|gif|webp|avif)$/i.test(sanitizedFilename)) {
      const importName = generateImageImportName(sanitizedFilename);
      imageImportsMap.set(sanitizedFilename, importName);
      return `{${importName}}`;
    }
    
    // Fallback for non-image files
    return `"./images-flat/${sanitizedFilename}"`;
  }
  
  // Fall back to the old logic if we don't have a mapping for this image
  let filename;
  
  // Check if it's an absolute path
  if (src.startsWith('/')) {
    // Extract the filename from the path
    filename = src.split('/').pop();
  } else if (src.includes('images-flat/')) {
    // Extract filename from relative path to images-flat
    filename = src.split('images-flat/').pop();
  } else {
    // For other relative paths that might point to images
    const parts = src.split('/');
    filename = parts[parts.length - 1];
  }
  
  // Check if it's an image file by extension
  if (filename && /\.(svg|png|jpg|jpeg|gif|webp|avif)$/i.test(filename)) {
    // Create import variable for ALL images (SVGs and PNGs)
    const importName = generateImageImportName(filename);
    imageImportsMap.set(filename, importName);
    return `{${importName}}`;
  }
  
  return src;
}

/**
 * Generate an import variable name for any image file
 * Uses already sanitized filename from sanitizeFilename function
 * @param {string} filename - The sanitized image filename
 * @returns {string} - A valid JavaScript variable name
 */
function generateImageImportName(filename) {
  // Remove extension from sanitized filename
  const baseName = filename.replace(/\.(svg|png|jpg|jpeg|gif|webp|avif)$/i, '');
  
  // Convert underscores to camelCase (filename is already sanitized)
  const variableName = baseName
    .split('_')
    .map((part, index) => {
      if (index === 0) {
        return part.toLowerCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
  
  return variableName;
}

/**
 * Reset the image imports tracking before each conversion
 */
function resetImageImports() {
  imageImportsMap = new Map();
}

/**
 * Set the sanitized filename mapping from extractImages.js
 * @param {Object} mapping - The mapping from original URLs to sanitized filenames
 */
function setSanitizedFilenameMap(mapping) {
  sanitizedFilenameMap = mapping || {};
}

/**
 * Escapes special characters in text for JSX output
 * @param {string} text - The text to escape
 * @returns {string} - Escaped text safe for JSX
 */
function escapeJSXText(text) {
  return text
    .replace(/&/g, '&amp;') // must come first
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Get the unique list of image imports as import statements
 * @returns {string} - Import statements for all images
 */
function getImageImports() {
  if (imageImportsMap.size === 0) return '';
  
  return Array.from(imageImportsMap.entries())
    .map(([filename, importName]) => 
      `import ${importName} from './images-flat/${filename}';`
    )
    .join('\n');
}

/**
 * Converts HTML attributes to JSX-compatible attribute strings.
 * Also handles custom CSS properties by generating class names.
 * @param {Object} attrs - HTML attributes map
 * @returns {string} - JSX-compatible attributes string
 */
function convertAttributes(attrs) {
  let jsx = "";
  let existingClass = null;

  for (const [key, value] of Object.entries(attrs)) {
    const keyLower = key.toLowerCase();

    if (!value || value === "" || value === "{}" || value === "[]" || value === "null") {
      continue;
    }

    if (keyLower === "class" || keyLower === "classname") {
      existingClass = value.trim();
      continue; // delay adding it until later
    }

    if (keyLower === "style") {
      const { styleString, cssVars } = convertStyle(value);

      if (styleString !== null) {
        jsx += ` style=${styleString}`;
      }

      if (Object.keys(cssVars).length > 0) {
        customClassCounter++;
        const customClass = `custom-var-${customClassCounter}`;
        cssVarMap[customClass] = cssVars;

        // Merge with any existing class
        existingClass = existingClass ? `${existingClass} ${customClass}` : customClass;
      }

      continue;
    }
    
    let jsxKey;
    // Handle XML/SVG namespace attributes (e.g., xmlns:xlink -> xmlnsXlink)
    if (key.includes(':')) {
      const [namespace, attr] = key.split(':');
      if (namespace.toLowerCase() === 'xmlns') {
        jsxKey = `xmlns${attr.charAt(0).toUpperCase()}${attr.slice(1)}`;
      } else {
        // Convert other namespaced attributes to camelCase
        jsxKey = `${namespace}${attr.charAt(0).toUpperCase()}${attr.slice(1)}`;
      }
    } else if (attributeRenameMap[keyLower]) {
      jsxKey = attributeRenameMap[keyLower];
    } else if (keyLower.startsWith("on")) {
      jsxKey = toJSXEventName(keyLower);
    } else if (keyLower.includes('-')) {
      // Convert hyphenated attributes to camelCase (especially for SVG)
      jsxKey = keyLower.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    } else {
      jsxKey = key;
    }

    if (keyLower === "data-props" || keyLower.startsWith("data-")) {
      try {
        const parsed = JSON.parse(value);
        const escapedValue = JSON.stringify(parsed).replace(/"/g, '&quot;');
        jsx += ` ${jsxKey}="${escapedValue}"`;
      } catch (e) {
        const escapedValue = value.replace(/"/g, '&quot;');
        jsx += ` ${jsxKey}="${escapedValue}"`;
      }
      continue;
    }

    // Fix src attributes that have absolute paths
    let attributeValue = value;
    if (keyLower === "src") {
      attributeValue = fixHtmlImagePath(value);
    }

    // Check if the attribute value contains curly braces (likely a React variable)
    if (typeof attributeValue === 'string' && attributeValue.startsWith('{') && attributeValue.endsWith('}')) {
      // Output without quotes for JSX expressions
      jsx += ` ${jsxKey}=${attributeValue}`;
    } else if (booleanAttributes.has(keyLower)) {
      if (value === "" || value === keyLower || value === true) {
        jsx += ` ${jsxKey}={true}`;
      } else if (value === "false" || value === false) {
        jsx += ` ${jsxKey}={false}`;
      } else if (isBooleanValue(value)) {
        // Handle "true" and "false" strings as actual booleans in JSX
        jsx += ` ${jsxKey}={${value.toLowerCase()}}`;
      } else {
        jsx += ` ${jsxKey}="${attributeValue}"`;
      }
    } else {
      const escapedValue = attributeValue.replace(/"/g, '&quot;');
      jsx += ` ${jsxKey}="${escapedValue}"`;
    }
  }

  if (existingClass) {
    jsx += ` className="${existingClass}"`;
  }

  return jsx;
}


/**
 * Converts the stored CSS variable map into a valid CSS class definition string.
 * @param {Object} cssVarMap - A map of class names to custom CSS variables
 * @returns {string} - CSS output string
 */
function generateCSSFromVars(cssVarMap) {
  return Object.entries(cssVarMap).map(([className, vars]) => {
    const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`);
    return `.${className} {\n${lines.join("\n")}\n}`;
  }).join("\n\n");
}

// Add more SVG attributes that need camelCase conversion
const svgAttributes = {
  // Base attributes already added to attributeRenameMap
  // Additional complex conversions
  'accent-height': 'accentHeight',
  'alignment-baseline': 'alignmentBaseline',
  'arabic-form': 'arabicForm',
  'baseline-shift': 'baselineShift',
  'cap-height': 'capHeight',
  'clip-path': 'clipPath',
  'color-interpolation': 'colorInterpolation',
  'color-interpolation-filters': 'colorInterpolationFilters',
  'color-profile': 'colorProfile',
  'color-rendering': 'colorRendering',
  'dominant-baseline': 'dominantBaseline',
  'enable-background': 'enableBackground',
  'flood-color': 'floodColor',
  'flood-opacity': 'floodOpacity',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-size-adjust': 'fontSizeAdjust',
  'font-stretch': 'fontStretch',
  'font-style': 'fontStyle',
  'font-variant': 'fontVariant',
  'font-weight': 'fontWeight',
  'glyph-name': 'glyphName',
  'glyph-orientation-horizontal': 'glyphOrientationHorizontal',
  'glyph-orientation-vertical': 'glyphOrientationVertical',
  'horiz-adv-x': 'horizAdvX',
  'horiz-origin-x': 'horizOriginX',
  'image-rendering': 'imageRendering',
  'letter-spacing': 'letterSpacing',
  'lighting-color': 'lightingColor',
  'marker-end': 'markerEnd',
  'marker-mid': 'markerMid',
  'marker-start': 'markerStart',
  'overline-position': 'overlinePosition',
  'overline-thickness': 'overlineThickness',
  'paint-order': 'paintOrder',
  'panose-1': 'panose1',
  'pointer-events': 'pointerEvents',
  'rendering-intent': 'renderingIntent',
  'shape-rendering': 'shapeRendering',
  'stop-color': 'stopColor',
  'stop-opacity': 'stopOpacity',
  'strikethrough-position': 'strikethroughPosition',
  'strikethrough-thickness': 'strikethroughThickness',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-miterlimit': 'strokeMiterlimit',
  'stroke-opacity': 'strokeOpacity',
  'stroke-width': 'strokeWidth',
  'text-anchor': 'textAnchor',
  'text-decoration': 'textDecoration',
  'text-rendering': 'textRendering',
  'underline-position': 'underlinePosition',
  'underline-thickness': 'underlineThickness',
  'unicode-bidi': 'unicodeBidi',
  'unicode-range': 'unicodeRange',
  'units-per-em': 'unitsPerEm',
  'v-alphabetic': 'vAlphabetic',
  'v-hanging': 'vHanging',
  'v-ideographic': 'vIdeographic',
  'v-mathematical': 'vMathematical',
  'vector-effect': 'vectorEffect',
  'vert-adv-y': 'vertAdvY',
  'vert-origin-x': 'vertOriginX',
  'vert-origin-y': 'vertOriginY',
  'word-spacing': 'wordSpacing',
  'writing-mode': 'writingMode',
  'x-height': 'xHeight',
  'xlink:actuate': 'xlinkActuate',
  'xlink:arcrole': 'xlinkArcrole',
  'xlink:href': 'xlinkHref',
  'xlink:role': 'xlinkRole',
  'xlink:show': 'xlinkShow',
  'xlink:title': 'xlinkTitle',
  'xlink:type': 'xlinkType',
  'xml:base': 'xmlBase',
  'xml:lang': 'xmlLang',
  'xml:space': 'xmlSpace'
};

// Add SVG attributes to the attributeRenameMap
Object.entries(svgAttributes).forEach(([key, value]) => {
  attributeRenameMap[key] = value;
});

/**
 * Converts a full HTML string to a JSX-compatible string.
 * Extracts only content from within the body tag and skips html, head, and script tags.
 * If no body tag is found, processes the entire content as JSX.
 * @param {string} html - Raw HTML input
 * @returns {string} - JSX output string
 */
function convertHTMLtoJSX(html) {
  // Reset image imports before each conversion
  resetImageImports();
  
  let output = "";
  const stack = [];
  let inBodyTag = false;
  let skipTag = false;
  let currentSkipTag = null;
  let depth = 0; // To track nested levels inside a skipped tag
  let bodyTagFound = false;
  let outputBeforeBodyTag = ""; // To store content in case no body tag is found
  let bodyAttributes = null; // Store body attributes to apply to wrapper div

  // Tags that should be completely removed or handled specially in React
  const skipTags = new Set(['html', 'head', 'script', 'noscript', 'iframe']);

  const parser = new cheerio.Parser(
    {
      onopentag(name, attributes) {
        // Remove namespace from tag name (e.g., svg:path -> path)
        const tagName = name.toLowerCase().replace(/^.*?:/, '');
        
        // Handle image tags specifically to prepare for imports
        if (tagName === 'img' && attributes.src) {
          attributes.src = fixHtmlImagePath(attributes.src);
        }
        
        // Skip problematic tags for React
        if (skipTags.has(tagName)) {
          skipTag = true;
          currentSkipTag = tagName;
          depth = 1;
          return;
        }

        // If we're inside a tag we want to skip, just increment the depth counter
        if (skipTag) {
          depth++;
          return;
        }

        // If we encounter a body tag, mark that we're inside it but don't output the tag itself
        // Instead, store its attributes to apply to a wrapper div later
        if (tagName === 'body') {
          inBodyTag = true;
          bodyTagFound = true;
          bodyAttributes = {...attributes}; // Store body attributes
          return;
        }
        
        // Special handling for style tags - convert to JSX style objects if possible
        // or include as an inline <style> tag if needed
        if (tagName === 'style') {
          // We'll handle styles by capturing their content and converting
          skipTag = true;
          currentSkipTag = tagName;
          depth = 1;
          return;
        }
        
        // If not in body tag, store content in case no body tag is found
        if (!inBodyTag) {
          const isSelfClosing = selfClosingTags.has(tagName);
          const tag = `<${tagName}${convertAttributes(attributes)}${isSelfClosing ? " />" : ">"}`;
          outputBeforeBodyTag += tag;
          return;
        }
        
        // Output tags if we're inside the body
        const isSelfClosing = selfClosingTags.has(tagName);
        const tag = `<${tagName}${convertAttributes(attributes)}${isSelfClosing ? " />" : ">"}`;
        output += tag;
        if (!isSelfClosing) stack.push({ tag: tagName, selfClosing: false });
        else stack.push({ tag: tagName, selfClosing: true });
      },

      ontext(text) {
        // Only output text if we're inside the body and not in a skipped tag
        if (inBodyTag && !skipTag && text.trim()) {
          output += escapeJSXText(text);
        } else if (!inBodyTag && !skipTag && text.trim()) {
          // If not in body tag, store text in case no body tag is found
          outputBeforeBodyTag += escapeJSXText(text);
        }
      },

      onclosetag(tagname) {
        // Remove namespace prefix from closing tag
        const tag = tagname.toLowerCase().replace(/^.*?:/, '');
        
        // If we're closing a skipped tag
        if (skipTag && tag === currentSkipTag) {
          depth--;
          if (depth === 0) {
            skipTag = false;
            currentSkipTag = null;
          }
          return;
        }

        // If we're inside a skipped tag, just decrement the depth counter
        if (skipTag) {
          depth--;
          return;
        }
        
        // If we're closing the body tag, mark that we're no longer inside it
        if (tag === 'body') {
          inBodyTag = false;
          return;
        }
        
        // Only output closing tags if we're inside the body
        if (!inBodyTag) {
          outputBeforeBodyTag += `</${tag}>`;
          return;
        }
        
        const last = stack.pop();
        if (!last || last.selfClosing) return;

        if (last.tag !== tag) {
          console.warn(`Mismatched tag: expected </${last.tag}>, got </${tag}>`);
        }
        output += `</${tag}>`;
      },

      oncomment() {
        // Ignore comments
      }
    },
    { decodeEntities: true }
  );

  parser.write(html);
  parser.end();

  // Handle any unclosed tags within the body content
  if (stack.length > 0) {
    console.warn("Malformed HTML detected - unclosed tags:", stack.map(item => item.tag));
    while (stack.length > 0) {
      const last = stack.pop();
      // Only close tags that aren't body or html (which we're skipping)
      if (last.tag !== 'body' && last.tag !== 'html') {
        output += `</${last.tag}>`;
      }
    }
  }

  // If no body tag was found, use the content that was collected
  if (!bodyTagFound && outputBeforeBodyTag) {
    console.log('No <body> tag found in HTML. Processing entire content as JSX.');
    output = outputBeforeBodyTag;
  } else if (bodyTagFound) {
    console.log('Found <body> tag. Processing only body content as JSX.');
  }

  // Build a regex pattern for boolean attributes
  const booleanAttrsPattern = Array.from(booleanAttributes).join('|');
  const booleanAttrsRegex = new RegExp(`\\s(${booleanAttrsPattern})="(true|false)"`, 'gi');

  // Clean up any React-incompatible attributes that might have been missed
  output = output
    // Convert inline event handlers
    .replace(/on([a-z]+)="([^"]*)"/gi, (_, event, handler) => {
      const jsxEvent = `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
      return `${jsxEvent}={() => { ${handler} }}`;
    })
    // Convert any remaining hyphenated attributes to camelCase (especially for SVG)
    .replace(/\s([a-z-]+)-([a-z-]+)="([^"]*)"/gi, (_, prefix, suffix, value) => {
      // Skip data- attributes
      if (prefix === 'data') return match;
      
      const camelCaseName = `${prefix}${suffix.charAt(0).toUpperCase()}${suffix.slice(1)}`;
      return ` ${camelCaseName}="${value}"`;
    })
    // Convert class attributes that might have been missed
    .replace(/\sclass="/g, ' className="')
    // Fix boolean attributes with quoted true/false values to use JSX syntax
    .replace(booleanAttrsRegex, (_, attr, value) => {
      // Get the correct JSX attribute name
      let jsxAttr = attr;
      if (attributeRenameMap[attr.toLowerCase()]) {
        jsxAttr = attributeRenameMap[attr.toLowerCase()];
      } else if (attr.includes('-')) {
        jsxAttr = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      }
      return ` ${jsxAttr}={${value.toLowerCase()}}`;
    });

  // If body attributes were found, create a wrapper div with those attributes
  if (bodyAttributes) {
    const wrapperAttributes = convertAttributes(bodyAttributes);
    return `<div${wrapperAttributes}>${output}</div>`;
  }

  return `<>${output}</>`;
}

module.exports = {
  convertHTMLtoJSX,
  generateCSSFromVars,
  cssVarMap,
  getImageImports,
  setSanitizedFilenameMap
};
