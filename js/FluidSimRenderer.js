class FluidSimRenderer {
    constructor(canvas){
        this.canvas = canvas;
        this.gl = canvas.getContext("webgl2");
        let gl = this.gl;

        if(!gl){
            console.error("Failed to get WebGL2 context!");
            return;
        }

        this.currFramebuffer = 0;
        this.requestAnimationFrameID = undefined;

        this.previousTime = 0;
        this.deltaTime = 0;

        this.uReset = 1;

        // Naming conventions based on names in shader code
        this.uniforms = {
            // Viewport dimensions to get texel coordinates
            uResolution: {
                location: undefined,
                value: () => [canvas.width, canvas.height],
                set: gl.uniform2fv,
            },

            // Previous frame's data (4 channels -> velocity + density)
            uPreviousFrame: {
                location: undefined,
                value: () => 0,
                set: gl.uniform1i,
            },

            // Time passed
            uDeltaTime: {
                location: undefined,
                value: () => this.deltaTime,
                set: gl.uniform1f,
            },

            // Resets the fluid container
            uReset: {
                location: undefined,
                value: () => {if(this.uReset > 0){let tmp = this.uReset; this.uReset = 0; return tmp;}},
                set: gl.uniform1i,
            },
        }
    }

    /* Returns a promise to set up this FluidSimRenderer object */
    init(){
        let gl = this.gl;
        return new Promise( (resolve, reject) => {
            // Create shader program from sources
            Promise.all([fetchText('../glsl/basicVS.glsl'), fetchText('../glsl/simFS.glsl'), fetchText('../glsl/renderFS.glsl')])
            .then(([basicVSource, simFSource, renderFSource]) => {
                let basicVS = loadShaderFromSource(gl, basicVSource, "x-shader/x-vertex");
                let simFS = loadShaderFromSource(gl, simFSource, "x-shader/x-fragment");

                this.createSimProgram(basicVS, simFS);
                if(!this.simProgram) reject();

                // RenderVS is also the basic VS
                let renderFS = loadShaderFromSource(gl, renderFSource, "x-shader/x-fragment");

                this.createRenderProgram(basicVS, renderFS);
                if(!this.renderProgram) reject();

                this.vertexArrayObject = gl.createVertexArray();
                gl.bindVertexArray(this.vertexArrayObject);

                gl.clearColor(0, 0, 0, 1);
                this.framebuffer = gl.createFramebuffer();

                // Create two textures to hold last frame and current frame (adopted from http://madebyevan.com/webgl-path-tracing/webgl-path-tracing.js)
                this.frameTextures = [];
                if(!gl.getExtension("EXT_color_buffer_float")){
                    throw "Error: This requires EXT_color_buffer_float extension to work properly";
                }
                for(let i = 0; i < 2; i++){
                    this.frameTextures.push(gl.createTexture());
                    gl.activeTexture(gl.TEXTURE0 + this.uniforms.uPreviousFrame.value());
                    gl.bindTexture(gl.TEXTURE_2D, this.frameTextures[i]);

                    // See https://www.khronos.org/registry/OpenGL-Refpages/gl4/html/glTexParameter.xhtml for details
                    // TODO: Should I set these to gl.LINEAR instead of gl.NEAREST to do bilinear interpolation for me?
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.FLOAT, null);
                }

                /* Set up vertex position buffer */
                this.vertexPositionBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexPositionBuffer);

                // Define a basic quad
                const vertices = [
                    -1, -1, 0,
                    -1, +1, 0,
                    +1, -1, 0,
                    -1, +1, 0,
                    +1, -1, 0,
                    +1, +1, 0,
                ];

                // Populate the buffer with the position data.
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
                this.vertexPositionBuffer.itemSize = 3;
                this.vertexPositionBuffer.numberOfItems = vertices.length / this.vertexPositionBuffer.itemSize;

                resolve();
            });
        });
    }

    /* Run the Simulation Shader to get this frame's fluid data */
    update(){
        let gl = this.gl;

        gl.useProgram(this.simProgram);
        gl.bindVertexArray(this.vertexArrayObject);

        // Enable each attribute we are using in the VAO.
        gl.enableVertexAttribArray(this.simProgram.vertexPositionAttribute);

        // Binds the vertexPositionBuffer to the vertex position attribute.
        gl.vertexAttribPointer(this.simProgram.vertexPositionAttribute, 
                               this.vertexPositionBuffer.itemSize, gl.FLOAT, false, 0, 0);

        // Send all necessary constants to shader
        this.setUniforms(this.uniforms);
            
        // Clear the screen.
        gl.clear(gl.COLOR_BUFFER_BIT);
    
        // Use the vertex array object that we set up.
        gl.bindVertexArray(this.vertexArrayObject);

        // Send texture of previous frame
        gl.activeTexture(gl.TEXTURE0 + this.uniforms.uPreviousFrame.value());
        gl.bindTexture(gl.TEXTURE_2D, this.frameTextures[this.currFramebuffer]);

        // Draw to frame buffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.frameTextures[1 - this.currFramebuffer], 0);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexPositionBuffer.numberOfItems);
        
        // Unbind to be safe
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Switch frameTextures
        this.currFramebuffer = 1 - this.currFramebuffer;
    }

    /* Run the Render Shader to display the fluid on screen */
    render(){
        let gl = this.gl;
        
        gl.useProgram(this.renderProgram);
        gl.bindVertexArray(this.vertexArrayObject);

        // Enable each attribute we are using in the VAO.
        gl.enableVertexAttribArray(this.renderProgram.vertexPositionAttribute);

        // Binds the buffers to the vertex position attribute.
        gl.vertexAttribPointer(this.renderProgram.vertexPositionAttribute, 
                               this.vertexPositionBuffer.itemSize, gl.FLOAT, false, 0, 0);

        /* Set uniforms */
        gl.bindTexture(gl.TEXTURE_2D, this.frameTextures[this.currFramebuffer]);

        /* Draw */
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindVertexArray(this.vertexArrayObject);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexPositionBuffer.numberOfItems);
        
        /* Unbind to be safe */
        gl.bindVertexArray(null);
    }

    start(){
        this.frameTimes = [];
        this.requestAnimationFrameID = requestAnimationFrame(this.animate.bind(this));
    }

    animate(time){
        this.deltaTime = time - this.previousTime;
        this.previousTime = time;
        
        this.update();
        this.render();
        this.requestAnimationFrameID = requestAnimationFrame(this.animate.bind(this));
    }

    stop(){
        cancelAnimationFrame(this.requestAnimationFrameID);
        this.requestAnimationFrameID = undefined;
        gl.useProgram(null);
    }

    reset(){
        this.uReset = 1; // TODO: allow for multiple reset presets
    }

    setUniforms(uniforms){
        let gl = this.gl;

        for(const [name, uniform] of Object.entries(uniforms)){
            let keys = Object.keys(uniform);
            if(keys.includes('location'), keys.includes('value'), keys.includes('set')){
                // This is a uniform, add it
                uniform.set.call(gl, uniform.location, uniform.value()); // TODO: do I need to use uniform.value.bind(this).call()?
            } else {
                // This is not yet a uniform (might be struct), recurse
                this.setUniforms(uniform);
            }
        }
    }

    initUniforms(uniforms, program, prefix = ''){
        let gl = this.gl;

        for(const [name, uniform] of Object.entries(uniforms)){
            let keys = Object.keys(uniform);
            if(keys.includes('location'), keys.includes('value'), keys.includes('set')){
                // This is a uniform, set it's location
                uniform.location = gl.getUniformLocation(program, prefix + name);
            } else {
                // This is not yet a uniform (might be struct), recurse
                this.initUniforms(uniform, program, prefix + name + '.');
            }
        }
    }

    createSimProgram(vertexShader, fragmentShader){
        let gl = this.gl;

        // Link the shaders together into a program.
        this.simProgram = gl.createProgram();
        gl.attachShader(this.simProgram, vertexShader);
        gl.attachShader(this.simProgram, fragmentShader);
        gl.linkProgram(this.simProgram);

        if (!gl.getProgramParameter(this.simProgram, gl.LINK_STATUS)) {
            console.error("Failed to setup shaders");
        }
        else{
            /* Create shader attribtues */ 
            this.simProgram.vertexPositionAttribute =
            gl.getAttribLocation(this.simProgram, "aVertexPosition");

            /* Create shader uniforms */
            this.initUniforms(this.uniforms, this.simProgram);
        }
    }

    createRenderProgram(vertexShader, fragmentShader){
        let gl = this.gl;

        // Link the shaders together into a program.
        this.renderProgram = gl.createProgram();
        gl.attachShader(this.renderProgram, vertexShader);
        gl.attachShader(this.renderProgram, fragmentShader);
        gl.linkProgram(this.renderProgram);

        if (!gl.getProgramParameter(this.renderProgram, gl.LINK_STATUS)) {
            console.error("Failed to setup shaders");
        }
        else{
            /* Create shader attribtues */ 
            this.renderProgram.vertexPositionAttribute =
            gl.getAttribLocation(this.renderProgram, "aVertexPosition");
        }
    }
}