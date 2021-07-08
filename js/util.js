/**
 * Loads a shader.
 * Retrieves the source code from the HTML document and compiles it.
 * @param {WebGL2RenderingContext} gl WebGL context to create the shader for
 * @param {string} id ID string for shader to load. Either vertex shader/fragment shader
 */
function loadShaderFromDOM(gl, id) {
    var shaderScript = document.getElementById(id);

    // If we don't find an element with the specified id
    // we do an early exit 
    if (!shaderScript) {
        return null;
    }
        
    var shaderSource = shaderScript.text;

    return loadShaderFromSource(gl, shaderSource, shaderScript.type);
}


function loadShaderFromSource(gl, shaderSource, type){
    var shader;
    if (type == "x-shader/x-fragment") {
        shader = gl.createShader(gl.FRAGMENT_SHADER);
    } else if (type = "x-shader/x-vertex") {
        shader = gl.createShader(gl.VERTEX_SHADER);
    } else {
        return null;
    }

    gl.shaderSource(shader, shaderSource);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.log(shaderSource);
        console.error(gl.getShaderInfoLog(shader));
        return null;
    } 
    return shader;
}


function fetchText(filePath){
    return new Promise((resolve, reject) => {
        fetch(filePath)
        .then(response => response.text())
        .then(text => resolve(text))
        .catch(err => reject(err));
    });
}