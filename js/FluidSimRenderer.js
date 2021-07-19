class FluidSimRenderer {
    constructor(canvas){
        this.canvas = canvas;
        this.gl = canvas.getContext("webgl2");
        let gl = this.gl;

        this.dataResolution = [80, 50]; //[16, 10];
        this.renderResolution = [800, 500];

        gl.clearColor(0, 0, 0, 1);

        if(!gl){
            console.error("Failed to get WebGL2 context!");
            return;
        }

        this.iterations = 50;

        this.currFrameTexture = 0;
        this.currIterationTexture = 0;
        this.requestAnimationFrameID = undefined;

        this.previousTime = 0;
        this.deltaTime = 0;

        this.uResetType = 1;
        this.uDiffusion = 1;

        // Naming conventions based on names in shader code
        this.diffusionUniforms = {
            // Viewport dimensions to get texel coordinates
            uResolution: {
                location: undefined,
                value: () => this.dataResolution,
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

            // Sets the diffusion factor
            uDiffusion: {
                location: undefined,
                value: () => this.uDiffusion,
                set: gl.uniform1f,
            },
        }

        this.advectionUniforms = {
            // Viewport dimensions to get texel coordinates
            uResolution: {
                location: undefined,
                value: () => this.dataResolution,
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
        }

        this.projectionUniforms = {
            // Viewport dimensions to get texel coordinates
            uResolution: {
                location: undefined,
                value: () => this.dataResolution,
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

            // The stage of projection we are in
            uStage: {
                location: undefined,
                value: () => this.uProjectionStage,
                set: gl.uniform1i,
            },
        }

        this.resetUniforms = {
            // Viewport dimensions to get texel coordinates
            uResolution: {
                location: undefined,
                value: () => this.dataResolution,
                set: gl.uniform2fv,
            },

            uResetType: {
                location: undefined,
                value: () => this.uResetType,
                set: gl.uniform1i,
            }
        }

        this.renderUniforms = {
            uData: {
                location: undefined,
                value: () => 0,
                set: gl.uniform1i,
            },

            uDataResolution: {
                location: undefined,
                value: () => this.dataResolution,
                set: gl.uniform2fv,
            },
        }
    }

    /* Returns a promise to set up this FluidSimRenderer object */
    init(){
        let gl = this.gl;
        return new Promise( (resolve, reject) => {
            // Create shader program from sources
            Promise.all([fetchText('../glsl/basicVS.glsl'), fetchText('../glsl/diffusionFS.glsl'),
                         fetchText('../glsl/advectionFS.glsl'), fetchText('../glsl/projectionFS.glsl'),
                         fetchText('../glsl/renderFS.glsl'), fetchText('../glsl/resetFS.glsl')])
            .then(([basicVSource, diffusionFSource, advectionFSource, projectionFSource, renderFSource, resetFSource]) => {
                let basicVS = loadShaderFromSource(gl, basicVSource, "x-shader/x-vertex");
                let diffusionFS = loadShaderFromSource(gl, diffusionFSource, "x-shader/x-fragment");
                let advectionFS = loadShaderFromSource(gl, advectionFSource, "x-shader/x-fragment");
                let projectionFS = loadShaderFromSource(gl, projectionFSource, "x-shader/x-fragment");
                let renderFS = loadShaderFromSource(gl, renderFSource, "x-shader/x-fragment");
                let resetFS = loadShaderFromSource(gl, resetFSource, "x-shader/x-fragment");

                /* Create shader programs for each stage of the fluid sim + rendering + reset */
                this.diffusionProgram = createShaderProgram(gl, basicVS, diffusionFS);
                if(!this.diffusionProgram) reject();
                initUniforms(gl, this.diffusionUniforms, this.diffusionProgram);

                this.advectionProgram = createShaderProgram(gl, basicVS, advectionFS);
                if(!this.advectionProgram) reject();
                initUniforms(gl, this.advectionUniforms, this.advectionProgram);

                this.projectionProgram = createShaderProgram(gl, basicVS, projectionFS);
                if(!this.projectionProgram) reject();
                initUniforms(gl, this.projectionUniforms, this.projectionProgram);

                this.renderProgram = createShaderProgram(gl, basicVS, renderFS);
                if(!this.renderProgram) reject();
                initUniforms(gl, this.renderUniforms, this.renderProgram);

                this.resetProgram = createShaderProgram(gl, basicVS, resetFS);
                if(!this.resetProgram) reject();
                initUniforms(gl, this.resetUniforms, this.resetProgram);

                this.vertexArrayObject = gl.createVertexArray();
                gl.bindVertexArray(this.vertexArrayObject);

                // We will need two sets of frame buffers and textures. The first, "frameTextures", is for each
                // actual frame of the simulation (we'll need two textures, one to hold previous data and one to render to).
                // The second, "iterationTextures", is for intermediate calculations done by shaders.
                // Similarly we will need two textures here.
                this.framebuffer = gl.createFramebuffer();

                // Create two textures to hold last frame and current frame (adopted from http://madebyevan.com/webgl-path-tracing/webgl-path-tracing.js)
                if(!gl.getExtension("EXT_color_buffer_float")){
                    console.error("Error: This requires EXT_color_buffer_float extension to work properly");
                    reject();
                }

                let initTexture = texture => {
                    gl.bindTexture(gl.TEXTURE_2D, texture);

                    // See https://www.khronos.org/registry/OpenGL-Refpages/gl4/html/glTexParameter.xhtml for details
                    // TODO: Should I set these to gl.LINEAR instead of gl.NEAREST to do bilinear interpolation for me?
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                    
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ...this.dataResolution, 0, gl.RGBA, gl.FLOAT, null);
                }

                this.frameTextures = [];
                this.iterationTextures = [];
                for(let i = 0; i < 2; i++){
                    this.frameTextures.push(gl.createTexture());
                    this.iterationTextures.push(gl.createTexture());

                    initTexture(this.frameTextures[i]);
                    initTexture(this.iterationTextures[i]);
                }

                // In WebGL we only have access to the general rasterization GPU pipeline. In our case we 
                // are treating this almost like a compute shader where we just want to do some work on our 
                // 2D array (texture) of data. This is why we have just one Vertex Shader (basicVS) and why
                // here our vertex data will just define a basic quad which covers the screen
                this.vertexPositionBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexPositionBuffer);
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

    /**
     * Helper function for switching shader programs and loading in vertex data.
     */
    useShader(shaderProgram){
        let gl = this.gl;

        gl.useProgram(shaderProgram);
        gl.bindVertexArray(this.vertexArrayObject);

        // Enable each attribute we are using in the VAO.
        gl.enableVertexAttribArray(shaderProgram.vertexPositionAttribute);

        // Binds the vertexPositionBuffer to the vertex position attribute.
        gl.vertexAttribPointer(shaderProgram.vertexPositionAttribute, 
                               this.vertexPositionBuffer.itemSize, gl.FLOAT, false, 0, 0);
    }

    /* Run the Simulation Shader to get this frame's fluid data */
    update(){
        let gl = this.gl;

        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.viewport(0, 0, ...this.dataResolution);

        // If reset flag is low, update as normal
        if(this.uResetType > 0){
            this.reset();
            this.uResetType = 0;
        }
        else{
            this.diffuse();
            this.advect();
            this.project();
        }

        // Unbind to be safe
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    diffuse() {
        let gl = this.gl;

        this.useShader(this.diffusionProgram);
        setUniforms(gl, this.diffusionUniforms);

        // Send texture of previous frame
        gl.activeTexture(gl.TEXTURE0 + this.diffusionUniforms.uPreviousFrame.value());
        gl.bindTexture(gl.TEXTURE_2D, this.frameTextures[this.currFrameTexture]);

        // In our loop we will be working with the uPreviousIteration texture
        gl.activeTexture(gl.TEXTURE0 + this.diffusionUniforms.uPreviousIteration.value());

        // Perform Gauss-Seidel with multiple iterations (drawing to iteration texture)
        // Start with a blank (all-0) texture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.iterationTextures[1 - this.currIterationTexture], 0);
        for(let i = 0; i < this.iterations; i++){
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

        this.useShader(this.advectionProgram);
        setUniforms(gl, this.advectionUniforms);

        gl.activeTexture(gl.TEXTURE0 + this.advectionUniforms.uPreviousIteration.value());
        gl.bindTexture(gl.TEXTURE_2D, this.iterationTextures[this.currIterationTexture]);

        // Advection can output to the offhand frameTexture since it doesn't use Gauss-Seidel
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.frameTextures[1 - this.currFrameTexture], 0);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexPositionBuffer.numberOfItems);

        // Switch frameTextures
        this.currFrameTexture = 1 - this.currFrameTexture;
    }

    project(){
        let gl = this.gl;
        
        this.useShader(this.projectionProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);

        // Stage 1: Gauss Seidel to find curl-free portion
        this.uProjectionStage = 0;
        setUniforms(gl, this.projectionUniforms);
        
        // Bind previous frame texture
        gl.activeTexture(gl.TEXTURE0 + this.projectionUniforms.uPreviousFrame.value());
        gl.bindTexture(gl.TEXTURE_2D, this.frameTextures[this.currFrameTexture]);

        for(let i = 0; i < this.iterations; i++){
            // Bind previous iteration texture
            gl.activeTexture(gl.TEXTURE0 + this.projectionUniforms.uPreviousIteration.value());
            gl.bindTexture(gl.TEXTURE_2D, this.iterationTextures[this.currIterationTexture]);

            // Render to next iteration texture
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.iterationTextures[1 - this.currIterationTexture], 0);
            gl.drawArrays(gl.TRIANGLES, 0, this.vertexPositionBuffer.numberOfItems);

            // Swap iteration textures
            this.currIterationTexture = 1 - this.currIterationTexture;
        }

        // Now do stage 2: calculating divergence-free portion
        this.uProjectionStage = 1;
        setUniforms(gl, this.projectionUniforms);
        gl.bindTexture(gl.TEXTURE_2D, this.iterationTextures[this.currIterationTexture]);

        // Render to frameTexture
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.frameTextures[1 - this.currFrameTexture], 0);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexPositionBuffer.numberOfItems);

        // Swap frameTextures
        this.currFrameTexture = 1 - this.currFrameTexture;
    }

    /* Run the Render Shader to display the fluid on screen */
    render(){
        let gl = this.gl;
        
        this.useShader(this.renderProgram);
        setUniforms(gl, this.renderUniforms);

        gl.viewport(0, 0, this.canvas.width, this.canvas.height); // Reset viewport to full canvas resolution

        /* Send data in the form of texture */
        gl.activeTexture(gl.TEXTURE0 + this.renderUniforms.uData.value());
        gl.bindTexture(gl.TEXTURE_2D, this.frameTextures[this.currFrameTexture]);

        /* Draw */
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Draw to canvas, not texture
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindVertexArray(this.vertexArrayObject);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexPositionBuffer.numberOfItems);

        // Unbind to be safe
        gl.bindVertexArray(null);

        // [this.canvas.width, this.canvas.height] = this.dataResolution; 
    }

    reset(){
        let gl = this.gl;
        
        this.useShader(this.resetProgram);

        /* Set uniforms */
        setUniforms(gl, this.resetUniforms);

        /* Draw */
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindVertexArray(this.vertexArrayObject);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.frameTextures[this.currFrameTexture], 0);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexPositionBuffer.numberOfItems);
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
}