class FluidSimRenderer {
    constructor(canvas){
        this.canvas = canvas;
        this.gl = canvas.getContext("webgl2");
        let gl = this.gl;

        if(!gl){
            console.error("Failed to get WebGL2 context!");
            return;
        }

        this.currFrameTexture = 0;
        this.currIterationTexture = 0;
        this.requestAnimationFrameID = undefined;

        this.previousTime = 0;
        this.deltaTime = 0;

        this.uReset = 1;
        this.uMode = 0;
        this.uDiffusion = 1;

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

            // Previous Gauss-Seidel iteration data
            uPreviousIteration: {
                location: undefined,
                value: () => 1,
                set: gl.uniform1i,
            },

            // Time passed
            uDeltaTime: {
                location: undefined,
                value: () => this.deltaTime / 1e3,
                set: gl.uniform1f,
            },

            // Resets the fluid container
            uReset: {
                location: undefined,
                value: () => this.uReset,
                set: gl.uniform1i,
            },

            // Sets the mode for the simulator
            uMode: {
                location: undefined,
                value: () => this.uMode,
                set: gl.uniform1i,
            },

            // Sets the diffusion factor
            uDiffusion: {
                location: undefined,
                value: () => this.uDiffusion,
                set: gl.uniform1f,
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

                this.simProgram = createShaderProgram(gl, basicVS, simFS);
                if(!this.simProgram) reject();
                initUniforms(gl, this.uniforms, this.simProgram);

                // RenderVS is also the basic VS
                let renderFS = loadShaderFromSource(gl, renderFSource, "x-shader/x-fragment");

                this.renderProgram = createShaderProgram(gl, basicVS, renderFS);
                if(!this.renderProgram) reject();

                this.vertexArrayObject = gl.createVertexArray();
                gl.bindVertexArray(this.vertexArrayObject);

                this.framebuffer = gl.createFramebuffer();
                this.iterationFramebuffer = gl.createFramebuffer();

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
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                    
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.FLOAT, null);
                }
                
                // Now do the same but for the iteration textures
                this.iterationTextures = [];
                let allZeros = new Float32Array(this.canvas.width * this.canvas.height * 4).fill(0);
                for(let i = 0; i < 2; i++){
                    this.iterationTextures.push(gl.createTexture());
                    gl.activeTexture(gl.TEXTURE0 + this.uniforms.uPreviousIteration.value());
                    gl.bindTexture(gl.TEXTURE_2D, this.iterationTextures[i]);

                    // See https://www.khronos.org/registry/OpenGL-Refpages/gl4/html/glTexParameter.xhtml for details
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                    
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.FLOAT, allZeros);
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

        // Perform all render calls
        this.diffuse();
        this.advect();
        this.project();

        // Unbind to be safe
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Disable reset flag if it was used
        this.uReset = 0;
    }

    diffuse() {
        let gl = this.gl;

        // Send uniforms        
        this.uMode = 0;
        setUniforms(gl, this.uniforms);
            
        // Clear the screen
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Send texture of previous frame
        gl.activeTexture(gl.TEXTURE0 + this.uniforms.uPreviousFrame.value());
        gl.bindTexture(gl.TEXTURE_2D, this.frameTextures[this.currFrameTexture]);

        // In our loop we will be working with the uPreviousIteration texture
        gl.activeTexture(gl.TEXTURE0 + this.uniforms.uPreviousIteration.value());

        // Perform Gauss-Seidel with multiple iterations (drawing to iteration texture)
        // Start with a blank (all-0) texture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.iterationFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.iterationTextures[1 - this.currIterationTexture], 0);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        for(let i = 0; i < 10; i++){
            // Set up input/output textures and draw
            gl.bindTexture(gl.TEXTURE_2D, this.iterationTextures[this.currIterationTexture]);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.iterationTextures[1 - this.currIterationTexture], 0);
            gl.drawArrays(gl.TRIANGLES, 0, this.vertexPositionBuffer.numberOfItems);

            // Switch iterationTextures
            this.currIterationTexture = 1 - this.currIterationTexture;
        }
    }

    advect(){
        let gl = this.gl;

        // Perform advection step
        this.uMode = 1;
        setUniforms(gl, this.uniforms);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.bindTexture(gl.TEXTURE_2D, this.iterationTextures[this.currIterationTexture]);
        gl.activeTexture(gl.TEXTURE0 + this.uniforms.uPreviousFrame.value());
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.frameTextures[1 - this.currFrameTexture], 0);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexPositionBuffer.numberOfItems);

        // Switch frameTextures
        this.currFrameTexture = 1 - this.currFrameTexture;
    }

    project(){
        let gl = this.gl;
        // Pass
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
        gl.bindTexture(gl.TEXTURE_2D, this.frameTextures[this.currFrameTexture]);

        /* Draw */
        gl.clearColor(0, 0, 0, 1);
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
        this.uReset = 2; // TODO: allow for multiple reset presets (maybe use a dropdown instead of button?)
    }
}