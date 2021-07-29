class FluidSimRenderer {
    constructor(canvas){
        this.canvas = canvas;
        this.gl = canvas.getContext("webgl2");
        let gl = this.gl;

        if(!gl){
            console.error("Failed to get WebGL2 context!");
            return;
        }

        if(!gl.getExtension("EXT_color_buffer_float")){
            console.error("Error: This requires EXT_color_buffer_float extension to work properly");
            return;
        }

        if(!gl.getExtension("OES_texture_float_linear")){
            console.error("Error: This requires OES_texture_float_linear extension to work properly");
            return;
        }

        
        ////////////////////////////////////// Configuration parameters ///////////////////////////////////////////////
        this.dataResolution = [320, 200];
        this.renderResolution = [800, 500];
        this.uResetType = 1;
        this.uDiffusion = 1;
        this.iterations = 50;

        [this.canvas.width, this.canvas.height] = this.renderResolution;

        
        ////////////////////////////////////// Initialize internal fields /////////////////////////////////////////////
        this.requestAnimationFrameID = undefined;
        this.previousTime = 0;
        this.deltaTime = 0;
        
        ////////////////////////////////////// Create required textures and VAOs //////////////////////////////////////
        let createTexture = () => {
            let texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            
            // See https://www.khronos.org/registry/OpenGL-Refpages/gl4/html/glTexParameter.xhtml for details
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            // All textures will be the same format so that we can have a single temp texture we swap with.
            // RGBA float textures seem the most supported -- RGB32F is not supported on Chrome, for example
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ...this.dataResolution, 0, gl.RGBA, gl.FLOAT, null);
            return texture;
        }

        this.dyeTexture       = createTexture();
        this.velocityTexture  = createTexture();
        this.vorticityTexture = createTexture();
        this.pressureTexture  = createTexture();
        this.tempTexture      = createTexture(); // Used for "editing in place" via texture swap

        // A framebuffer is the tool we need to be able to render-to-texture.
        // Essentially, it will let us make our fragment shaders output to our 
        // textures instead of showing up on screen. This allows us to use them
        // in subsequent steps.
        this.framebuffer = gl.createFramebuffer();


        // We will also need two sets of Vertex Array Objects (VAOs) and 
        // vertex buffers. This is because we will be running our main 
        // set of programs on a big quad (rectangle), but the boundary of
        // our screen will have a separate program run to enforce boundary conditions.
        this.quad = {
            vao: gl.createVertexArray(),
            buffer: gl.createBuffer(),
            data: [
                -1, -1, 0,
                -1, +1, 0,
                +1, -1, 0,
                -1, +1, 0,
                +1, -1, 0,
                +1, +1, 0,
            ],
            itemSize: 3,
            nItems: 6,
            glDrawEnum: gl.TRIANGLES,
        };
        gl.bindVertexArray(this.quad.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.quad.data), gl.STATIC_DRAW);

        this.boundary = {
            vao: gl.createVertexArray(),
            buffer: gl.createBuffer(),
            data: [
                -1, -1, 0,
                -1, +1, 0,
                +1, +1, 0,
                +1, -1, 0,
            ],
            itemSize: 3,
            nItems: 4,
            glDrawEnum: gl.LINE_LOOP,
        };
        gl.bindVertexArray(this.boundary.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.boundary.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.boundary.data), gl.STATIC_DRAW);

        
        ////////////////////////////////////// Shader Locations ///////////////////////////////////////////////////////
        let createLocations = names => {
            let obj = {};
            names.forEach(name => { obj[name] = null; });
            return obj;
        }

        this.advectionUniforms  = createLocations(["x", "vel", "dt", "res"]);
        this.jacobiUniforms     = createLocations(["x", "b", "alpha", "rBeta", "res"]);
        this.forcesUniforms     = createLocations(["vel", "dt", "res", "userForceRad", "userForcePos", "userForceStrength"]);
        this.divergenceUniforms = createLocations(["x", "res"]);
        this.removeDivergenceUniforms = createLocations(["vel", "p", "res"]);
        this.boundaryUniforms   = createLocations(["x", "res", "offset", "coeff"]);
        this.renderUniforms     = createLocations(["dye", "vel", "dataRes"]);


        ////////////////////////////////////// Mouse Tracking /////////////////////////////////////////////////////////
        this.mouse = {
            pos: [0, 0],
            vel: [0, 0],
        };

        let getNextPos = e => [
            e.offsetX * this.dataResolution[0] / this.canvas.clientWidth,
            (this.canvas.offsetHeight - e.offsetY) * this.dataResolution[1] / this.canvas.clientHeight
        ];

        this.mousedown = false;
        this.mousemoveTime = performance.now();
        this.canvas.addEventListener('mousedown', e => {
            this.mousemoveTime = performance.now();
            this.mouse.pos = getNextPos(e);
            this.mouse.vel = [0, 0];

            this.mousedown = true;
        });
        
        // For mouseup we use document in case they dragged off canvas before mouseup
        document.addEventListener('mouseup',  () => { this.mousedown = false; });

        this.canvas.addEventListener('mousemove', e => {
            if (!this.mousedown) return; 
            
            let now = performance.now();
            let dt = (now - this.mousemoveTime) / 1e3;
            this.mousemoveTime = now;

            let nextPos = getNextPos(e);

            this.mouse.vel = [(nextPos[0] - this.mouse.pos[0]) / dt, (nextPos[1] - this.mouse.pos[1]) / dt];
            this.mouse.pos = nextPos;
        });
    }

    /* Returns a promise to set up this FluidSimRenderer object */
    init(){
        let gl = this.gl;
        return new Promise( (resolve, reject) => {
            // Create shader program from sources
            Promise.all([fetchText('../glsl/basicVS.glsl'), fetchText('../glsl/advect.glsl'),
                         fetchText('../glsl/jacobi.glsl'), fetchText('../glsl/forces.glsl'),
                         fetchText('../glsl/divergence.glsl'), fetchText('../glsl/removeDivergence.glsl'),
                         fetchText('../glsl/boundary.glsl'), fetchText('../glsl/render.glsl')])
            .then(([basicVSource, advectSource, jacobiSource, forcesSource, divergenceSource, 
                    removeDivergenceSource, boundarySource, renderSource]) => {
                
                // We first create shaders and then shader programs from our gathered sources.
                // Each operation we want to perform on our data is its own shader program.
                // Since we are working through the general graphics pipeline and not compute 
                // shaders (which don't yet exist for web), we have all of our programs
                // use the "basicVS" vertex shader which just computes UV coordinates to pass
                // on to the each fragment. The "initUniforms" calls set up the prerequisites
                // to enable us to send uniforms to each program when we run it.

                let basicVS = loadShaderFromSource(gl, basicVSource, "x-shader/x-vertex");
                let advectFS = loadShaderFromSource(gl, advectSource, "x-shader/x-fragment");
                let jacobiFS = loadShaderFromSource(gl, jacobiSource, "x-shader/x-fragment");
                let forcesFS = loadShaderFromSource(gl, forcesSource, "x-shader/x-fragment");
                let divergenceFS = loadShaderFromSource(gl, divergenceSource, "x-shader/x-fragment");
                let removeDivergenceFS = loadShaderFromSource(gl, removeDivergenceSource, "x-shader/x-fragment");
                let boundaryFS = loadShaderFromSource(gl, boundarySource, "x-shader/x-fragment");
                let renderFS = loadShaderFromSource(gl, renderSource, "x-shader/x-fragment");

                let initUniforms = (uniforms, shader) => {
                    for(const name of Object.keys(uniforms)){
                        uniforms[name] = gl.getUniformLocation(shader, name);
                    }
                }

                this.advectionProgram = createShaderProgram(gl, basicVS, advectFS);
                if(!this.advectionProgram) { reject(); return; }
                initUniforms(this.advectionUniforms, this.advectionProgram);

                this.jacobiProgram = createShaderProgram(gl, basicVS, jacobiFS);
                if(!this.jacobiProgram) { reject(); return; }
                initUniforms(this.jacobiUniforms, this.jacobiProgram);

                this.forcesProgram = createShaderProgram(gl, basicVS, forcesFS);
                if(!this.forcesProgram) { reject(); return; }
                initUniforms(this.forcesUniforms, this.forcesProgram);

                this.divergenceProgram = createShaderProgram(gl, basicVS, divergenceFS);
                if(!this.divergenceProgram) { reject(); return; }
                initUniforms(this.divergenceUniforms, this.divergenceProgram);

                this.removeDivergenceProgram = createShaderProgram(gl, basicVS, removeDivergenceFS);
                if(!this.removeDivergenceProgram) { reject(); return; }
                initUniforms(this.removeDivergenceUniforms, this.removeDivergenceProgram);

                this.boundaryProgram = createShaderProgram(gl, basicVS, boundaryFS);
                if(!this.boundaryProgram) { reject(); return; }
                initUniforms(this.boundaryUniforms, this.boundaryProgram);
    
                this.renderProgram = createShaderProgram(gl, basicVS, renderFS);
                if(!this.renderProgram) { reject(); return; }
                initUniforms(this.renderUniforms, this.renderProgram);


                resolve();
            });
        });
    }

    /* Run the Simulation Shader to get this frame's fluid data */
    update(deltaTime){
        let gl = this.gl;

        // If reset flag is low, update as normal, otherwise reset
        if(this.uResetType > 0){
            // TODO: Re-implement reset but just reset to all 0s (no presets)
            this.uResetType = 0;
        }
        else{

            // All texture operations output to this.tempTexture, so we will have to swap
            // around our textures to mimic outputting to the actual one we want. This is
            // a necessary step because WebGL cannot output to a texture which is also an 
            // input uniform which is often what we want!
            let tmp; // Used to swap textures

            ///////////////////////////////////////// Step 1: Advection ///////////////////////////////////////////////
            // a) Velocity
            this.advect(this.velocityTexture, this.velocityTexture, deltaTime);
            tmp = this.velocityTexture; this.velocityTexture = this.tempTexture; this.tempTexture = tmp;
            
            // b) Dye
            this.advect(this.dyeTexture, this.velocityTexture, deltaTime);
            tmp = this.dyeTexture; this.dyeTexture = this.tempTexture; this.tempTexture = tmp;
            

            ///////////////////////////////////////// Step 2: Diffusion ///////////////////////////////////////////////
            // a) Velocity
            let vk = 220 * deltaTime;
            this.jacobi(this.velocityTexture, this.velocityTexture, vk/4, 4/vk * (1 + vk));
            tmp = this.velocityTexture; this.velocityTexture = this.tempTexture; this.tempTexture = tmp;
            
            // b) Dye
            // let dk = 1 * deltaTime;
            // this.jacobi(this.dyeTexture, this.dyeTexture, dk/4, 4/dk * (1 + dk));
            // tmp = this.dyeTexture; this.dyeTexture = this.tempTexture; this.tempTexture = tmp;


            ///////////////////////////////////////// Step 3: External Forces /////////////////////////////////////////
            let strength = this.mousedown ? this.mouse.vel : [0, 0];
            this.applyForces(this.velocityTexture, deltaTime, this.mouse.pos, 50, strength);
            tmp = this.velocityTexture; this.velocityTexture = this.tempTexture; this.tempTexture = tmp;


            ///////////////////////////////////////// Step 4: Projection //////////////////////////////////////////////
            // a) Compute pressure
            // b) Subtract gradient

            
            ///////////////////////////////////////// Step 5: Visualization ///////////////////////////////////////////
            this.render();
        }

        // Unbind to be safe
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }


    ////////////////////////////////////// Texture Operations /////////////////////////////////////////////////////////
    // We abstract out each texture operation as a function which takes in the uniform values to pass in.
    // All functions output to this.tempTexture

    /** Advects a quantity through a velocity field
     * See ../glsl/advect.glsl for detailed information
     * @param {*} x 
     * @param {*} vel 
     * @param {*} dt 
     */
    advect(x, vel, dt){
        let gl = this.gl;

        // Set up WebGL to use this program and the correct geometry
        gl.useProgram(this.advectionProgram);
        gl.bindVertexArray(this.quad.vao);
        gl.enableVertexAttribArray(this.advectionProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.vertexAttribPointer(this.advectionProgram.vertexPositionAttribute, this.quad.itemSize, gl.FLOAT, false, 0, 0);

        // Send uniforms
        gl.uniform1i(this.advectionUniforms.x, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, x);

        gl.uniform1i(this.advectionUniforms.vel, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, vel);

        gl.uniform1f(this.advectionUniforms.dt, dt);
        gl.uniform2fv(this.advectionUniforms.res, this.dataResolution);

        // Set to render to tempTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tempTexture, 0);

        let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if(status != gl.FRAMEBUFFER_COMPLETE){ console.error("Problem w/ framebuffer: " + status); }

        // Run program
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }

    /** Solves a system of linear equations
     * See ../glsl/jacobi.glsl for detailed information
     * @param {*} x 
     * @param {*} b 
     * @param {*} alpha 
     * @param {*} beta
     */
    jacobi(x, b, alpha, beta){
        let gl = this.gl;

        // Set up WebGL to use this program and the correct geometry
        gl.useProgram(this.jacobiProgram);
        gl.bindVertexArray(this.quad.vao);
        gl.enableVertexAttribArray(this.jacobiProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.vertexAttribPointer(this.jacobiProgram.vertexPositionAttribute, this.quad.itemSize, gl.FLOAT, false, 0, 0);

        // Send uniforms
        gl.uniform1i(this.jacobiUniforms.x, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, x);

        gl.uniform1i(this.jacobiUniforms.b, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, b);

        gl.uniform1f(this.jacobiUniforms.alpha, alpha);
        gl.uniform1f(this.jacobiUniforms.rBeta, 1/beta);
        gl.uniform2fv(this.jacobiUniforms.res, this.dataResolution);

        // Set to render to tempTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tempTexture, 0);

        // Run program
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }

    /** Applies forces by modifying velocity
     * See ../glsl/forces.glsl for detailed information
     * @param {*} vel
     * @param {*} dt 
     * @param {*} userForcePos
     * @param {*} userForceRad
     * @param {*} userForceStrength 
     */
    applyForces(vel, dt, userForcePos, userForceRad, userForceStrength){
        let gl = this.gl;

        // Set up WebGL to use this program and the correct geometry
        gl.useProgram(this.forcesProgram);
        gl.bindVertexArray(this.quad.vao);
        gl.enableVertexAttribArray(this.forcesProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.vertexAttribPointer(this.forcesProgram.vertexPositionAttribute, this.quad.itemSize, gl.FLOAT, false, 0, 0);

        // Send uniforms
        gl.uniform1i(this.forcesUniforms.vel, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, vel);

        gl.uniform1f(this.forcesUniforms.dt, dt);
        gl.uniform2fv(this.forcesUniforms.res, this.dataResolution);
        gl.uniform2fv(this.forcesUniforms.userForcePos, userForcePos);
        gl.uniform1f(this.forcesUniforms.userForceRad, userForceRad);
        gl.uniform2fv(this.forcesUniforms.userForceStrength, userForceStrength);

        // Set to render to tempTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tempTexture, 0);

        // Run program
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }

    /** Calculates divergence of an input vector field
     * See ../glsl/forces.glsl for detailed information
     * @param {*} x 
     */
    computDivergence(x){
        let gl = this.gl;

        // Set up WebGL to use this program and the correct geometry
        gl.useProgram(this.divergenceProgram);
        gl.bindVertexArray(this.quad.vao);
        gl.enableVertexAttribArray(this.divergenceProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.vertexAttribPointer(this.divergenceProgram.vertexPositionAttribute, this.quad.itemSize, gl.FLOAT, false, 0, 0);

        // Send uniforms
        gl.uniform1i(this.divergenceUniforms.x, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, x);

        gl.uniform2fv(this.divergenceUniforms.res, this.dataResolution);

        // Set to render to tempTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tempTexture, 0);

        // Run program
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }

    /** Removes divergence of an input vector field (when paired with divergence())
     * See ../glsl/removeDivergence.glsl for detailed information
     * @param {*} vel
     * @param {*} p
     */
    removeDivergence(vel, p){
        let gl = this.gl;

        // Set up WebGL to use this program and the correct geometry
        gl.useProgram(this.removeDivergenceProgram);
        gl.bindVertexArray(this.quad.vao);
        gl.enableVertexAttribArray(this.removeDivergenceProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.vertexAttribPointer(this.removeDivergenceProgram.vertexPositionAttribute, this.quad.itemSize, gl.FLOAT, false, 0, 0);

        // Send uniforms
        gl.uniform1i(this.removeDivergenceUniforms.vel, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, vel);

        gl.uniform1i(this.removeDivergenceUniforms.p, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, p);

        gl.uniform2fv(this.removeDivergenceUniforms.res, this.dataResolution);

        // Set to render to tempTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tempTexture, 0);

        // Run program
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }

    /** Enforces boundary conditions on the given texture
     * See ../glsl/boundary.glsl for detailed information
     * @param {*} x
     * @param {*} offset
     * @param {*} coeff 
     */
    enforceBoundary(x, offset, coeff){
        let gl = this.gl;

        // Set up WebGL to use this program and the correct geometry
        gl.useProgram(this.boundaryProgram);
        gl.bindVertexArray(this.boundary.vao);
        gl.enableVertexAttribArray(this.boundaryProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.boundary.buffer);
        gl.vertexAttribPointer(this.boundaryProgram.vertexPositionAttribute, this.boundary.itemSize, gl.FLOAT, false, 0, 0);

        // Send uniforms
        gl.uniform1i(this.boundaryUniforms.x, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, x);

        gl.uniform2fv(this.boundaryUniforms.res, this.dataResolution);
        gl.uniform1f(this.boundaryUniforms.offset, offset);
        gl.uniform1f(this.boundaryUniforms.coeff, coeff);

        // Set to render to tempTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tempTexture, 0);

        // Run program
        gl.drawArrays(this.boundary.glDrawEnum, 0, this.boundary.nItems);
    }


    render(){
        let gl = this.gl;

        // TODO: Can I use quad here? Or do I need a fullQuad or something?

        // Set up WebGL to use this program and the correct geometry
        gl.useProgram(this.renderProgram);
        gl.bindVertexArray(this.quad.vao);
        gl.enableVertexAttribArray(this.renderProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.vertexAttribPointer(this.renderProgram.vertexPositionAttribute, this.quad.itemSize, gl.FLOAT, false, 0, 0);

        // Send uniforms
        gl.uniform1i(this.renderUniforms.dye, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.dyeTexture);

        gl.uniform1i(this.renderUniforms.vel, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.velocityTexture);

        gl.uniform2fv(this.renderUniforms.dataRes, this.dataResolution);

        // Run program (and render to screen)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, ...this.renderResolution);
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }

    play(){
        this.requestAnimationFrameID = requestAnimationFrame(this.animate.bind(this));
    }

    animate(time){
        let deltaTime = time - this.previousTime;
        this.previousTime = time;
        
        this.update(deltaTime / 1e3);
        this.render();
        this.requestAnimationFrameID = requestAnimationFrame(this.animate.bind(this));
    }

    pause(){
        let gl = this.gl;
        cancelAnimationFrame(this.requestAnimationFrameID);
        this.requestAnimationFrameID = undefined;
        gl.useProgram(null);
    }
}