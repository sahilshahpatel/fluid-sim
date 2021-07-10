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


function setUniforms(gl, uniforms){
    for(const [name, uniform] of Object.entries(uniforms)){
        let keys = Object.keys(uniform);
        if(keys.includes('location'), keys.includes('value'), keys.includes('set')){
            // This is a uniform, add it
            uniform.set.call(gl, uniform.location, uniform.value());
        } else {
            // This is not yet a uniform (might be struct), recurse
            setUniforms(gl, uniform);
        }
    }
}


function initUniforms(gl, uniforms, program, prefix = ''){
    for(const [name, uniform] of Object.entries(uniforms)){
        let keys = Object.keys(uniform);
        if(keys.includes('location'), keys.includes('value'), keys.includes('set')){
            // This is a uniform, set it's location
            uniform.location = gl.getUniformLocation(program, prefix + name);
        } else {
            // This is not yet a uniform (might be struct), recurse
            initUniforms(gl, uniform, program, prefix + name + '.');
        }
    }
}


function createShaderProgram(gl, vertexShader, fragmentShader){
    // Link the shaders together into a program.
    let shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.error("Failed to setup shaders");
        return null;
    }
    else{
        /* Create shader attribtues */ 
        shaderProgram.vertexPositionAttribute =
        gl.getAttribLocation(shaderProgram, "aVertexPosition");
    }

    return shaderProgram;
}