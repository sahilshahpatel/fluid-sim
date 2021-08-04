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
        this.settings = {
            dataResolution: [320, 200],
            renderResolution: [800, 500],
            dyeDiffusionStrength: 0,
            velocityDiffusionStrength: 1,
            diffusionIterations: 25,
            projectionIterations: 40,
            vorticityConfinement: 5,
            drawArrows: 0,
        }

        
        ////////////////////////////////////// Initialize internal fields /////////////////////////////////////////////
        this.requestAnimationFrameID = undefined;
        this.previousTime = 0;
        this.deltaTime = 0;
        [this.canvas.width, this.canvas.height] = this.settings.renderResolution;

        
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
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ...this.settings.dataResolution, 0, gl.RGBA, gl.FLOAT, null);
            return texture;
        }

        this.dyeTexture        = createTexture();
        this.velocityTexture   = createTexture();
        this.vorticityTexture  = createTexture();
        this.pressureTexture   = createTexture();
        this.divergenceTexture = createTexture();
        this.outputTexture     = createTexture(); // Used for "editing in place" via texture swap

        // A framebuffer is the tool we need to be able to render-to-texture.
        // Essentially, it will let us make our fragment shaders output to our 
        // textures instead of showing up on screen. This allows us to use them
        // in subsequent steps.
        this.framebuffer = gl.createFramebuffer();
        this.copyFramebuffer = gl.createFramebuffer(); // We need a second FB for copying textures


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

        // dx, dy are deltas to get our lines to go straight through data cell centers
        let dx = 1 / this.settings.dataResolution[0];
        let dy = 1 / this.settings.dataResolution[1];
        this.boundary = {
            vao: gl.createVertexArray(),
            buffer: gl.createBuffer(),
            data: [
                -1+dx, -1+dy, 0,
                -1+dx, +1-dy, 0,
                +1-dx, +1-dy, 0,
                +1-dx, -1+dy, 0,
                -1+dx, -1+dy, 0,
            ],
            itemSize: 3,
            nItems: 5,
            glDrawEnum: gl.LINES,
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
        this.forcesUniforms     = createLocations(["vel", "curl", "dt", "res", "userForceRad", "userForcePos", 
                                                   "userForceStrength", "vorticityStrength"]);
        this.divergenceUniforms = createLocations(["x", "res"]);
        this.removeDivergenceUniforms = createLocations(["vel", "p", "res"]);
        this.curlUniforms       = createLocations(["x", "res"]);
        this.boundaryUniforms   = createLocations(["x", "res", "offset", "coeff"]);
        this.renderUniforms     = createLocations(["dye", "vel", "drawArrows", "dataRes"]);


        ////////////////////////////////////// Mouse Tracking /////////////////////////////////////////////////////////
        this.mouse = {
            pos: [0, 0],
            vel: [0, 0],
        };

        let getNextPos = e => [
            e.offsetX * this.settings.dataResolution[0] / this.canvas.clientWidth,
            (this.canvas.offsetHeight - e.offsetY) * this.settings.dataResolution[1] / this.canvas.clientHeight
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
            Promise.all([fetchText('glsl/basicVS.glsl'), fetchText('glsl/advect.glsl'),
                         fetchText('glsl/jacobi.glsl'), fetchText('glsl/forces.glsl'),
                         fetchText('glsl/divergence.glsl'), fetchText('glsl/removeDivergence.glsl'),
                         fetchText('glsl/curl.glsl'), fetchText('glsl/boundary.glsl'),
                         fetchText('glsl/render.glsl')])
            .then(([basicVSource, advectSource, jacobiSource, forcesSource, divergenceSource, 
                    removeDivergenceSource, curlSource, boundarySource, renderSource]) => {
                
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
                let curlFS = loadShaderFromSource(gl, curlSource, "x-shader/x-fragment");
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

                this.curlProgram = createShaderProgram(gl, basicVS, curlFS);
                if(!this.curlProgram) { reject(); return; }
                initUniforms(this.curlUniforms, this.curlProgram);

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
        // All texture operations output to this.outputTexture, so we will have to swap
        // around our textures to mimic outputting to the actual one we want. This is
        // a necessary step because WebGL cannot output to a texture which is also an 
        // input uniform which is often what we want!
        let tmp; // Used to swap textures


        ///////////////////////////////////////// Step 1: Advection ///////////////////////////////////////////////
        // a) Advect velocity
        this.advect(this.velocityTexture, this.velocityTexture, deltaTime);
        tmp = this.velocityTexture; this.velocityTexture = this.outputTexture; this.outputTexture = tmp;
        
        // b) Advect dye
        this.advect(this.dyeTexture, this.velocityTexture, deltaTime);
        tmp = this.dyeTexture; this.dyeTexture = this.outputTexture; this.outputTexture = tmp;
        

        ///////////////////////////////////////// Step 2: Diffusion ///////////////////////////////////////////////
        // a) Velocity
        if(this.settings.velocityDiffusionStrength != 0){
            let vk = this.settings.velocityDiffusionStrength * deltaTime;
            for(let i = 0; i < this.settings.diffusionIterations; i++){
                this.jacobi(this.velocityTexture, this.velocityTexture, 4/vk, 4/vk * (1 + vk));
                tmp = this.velocityTexture; this.velocityTexture = this.outputTexture; this.outputTexture = tmp;
            }
        }

        // b) Dye
        if(this.settings.dyeDiffusionStrength != 0){
            let dk = this.settings.dyeDiffusionStrength * deltaTime;
            for(let i = 0; i < this.settings.diffusionIterations; i++){
                this.jacobi(this.dyeTexture, this.dyeTexture, 4/dk, 4/dk * (1 + dk));
                tmp = this.dyeTexture; this.dyeTexture = this.outputTexture; this.outputTexture = tmp;
            }
        }


        ///////////////////////////////////////// Step 3: External Forces /////////////////////////////////////////
        // a) Compute vorticity (curl)
        this.computeCurl(this.velocityTexture);
        tmp = this.vorticityTexture; this.vorticityTexture = this.outputTexture; this.outputTexture = tmp;
        
        // b) Apply forces to velocity field
        let minDim = Math.min(this.settings.dataResolution[0], this.settings.dataResolution[1]);
        let strength = this.mousedown ? this.mouse.vel : [0, 0];
        this.applyForces(this.velocityTexture, this.vorticityTexture, deltaTime, this.mouse.pos, 0.75 * minDim, strength, this.settings.vorticityConfinement);
        tmp = this.velocityTexture; this.velocityTexture = this.outputTexture; this.outputTexture = tmp;

        // c) "Apply forces" to dye field (inserts dye)
        strength = this.mousedown ? [25, 0] : [0, 0];
        this.applyForces(this.dyeTexture, this.vorticityTexture, deltaTime, this.mouse.pos, 0.3 * minDim, strength, 0);
        tmp = this.dyeTexture; this.dyeTexture = this.outputTexture; this.outputTexture = tmp;


        ///////////////////////////////////////// Step 4: Projection //////////////////////////////////////////////
        // a) Compute divergence of velocity
        this.computeDivergence(this.velocityTexture);
        tmp = this.divergenceTexture; this.divergenceTexture = this.outputTexture; this.outputTexture = tmp;

        // b) Compute pressure
        this.clearTexture(this.pressureTexture);
        for(let i = 0; i < this.settings.projectionIterations; i++){
            this.jacobi(this.pressureTexture, this.divergenceTexture, -1, 4);
            tmp = this.pressureTexture; this.pressureTexture = this.outputTexture; this.outputTexture = tmp;

            this.enforceBoundary(this.pressureTexture, 1);
            tmp = this.pressureTexture; this.pressureTexture = this.outputTexture; this.outputTexture = tmp;
        }

        // c) Enforce velocity boundary condition
        this.enforceBoundary(this.velocityTexture, -1);
        tmp = this.velocityTexture; this.velocityTexture = this.outputTexture; this.outputTexture = tmp;

        // d) Subtract gradient
        this.removeDivergence(this.velocityTexture, this.pressureTexture);
        tmp = this.velocityTexture; this.velocityTexture = this.outputTexture; this.outputTexture = tmp;        

        
        ///////////////////////////////////////// Step 5: Visualization ///////////////////////////////////////////
        this.render();
    }


    ////////////////////////////////////// Texture Operations /////////////////////////////////////////////////////////
    // We abstract out each texture operation as a function which takes in the uniform values to pass in.
    // All functions output to this.outputTexture

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
        gl.uniform2fv(this.advectionUniforms.res, this.settings.dataResolution);

        // Set to render to outputTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);

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

        if(b === x){
            gl.uniform1i(this.jacobiUniforms.b, 0);
        }
        else{
            gl.uniform1i(this.jacobiUniforms.b, 1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, b);
        }

        gl.uniform1f(this.jacobiUniforms.alpha, alpha);
        gl.uniform1f(this.jacobiUniforms.rBeta, 1/beta);
        gl.uniform2fv(this.jacobiUniforms.res, this.settings.dataResolution);

        // Set to render to outputTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);

        // Run program
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }

    /** Applies forces by modifying velocity
     * See ../glsl/forces.glsl for detailed information
     * @param {*} vel
     * @param {*} curl
     * @param {*} dt 
     * @param {*} userForcePos
     * @param {*} userForceRad
     * @param {*} userForceStrength 
     * @param {*} vorticityStrength
     */
    applyForces(vel, curl, dt, userForcePos, userForceRad, userForceStrength, vorticityStrength){
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

        gl.uniform1i(this.forcesUniforms.curl, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, curl);

        gl.uniform1f(this.forcesUniforms.dt, dt);
        gl.uniform2fv(this.forcesUniforms.res, this.settings.dataResolution);
        gl.uniform2fv(this.forcesUniforms.userForcePos, userForcePos);
        gl.uniform1f(this.forcesUniforms.userForceRad, userForceRad);
        gl.uniform2fv(this.forcesUniforms.userForceStrength, userForceStrength);
        gl.uniform1f(this.forcesUniforms.vorticityStrength, vorticityStrength);

        // Set to render to outputTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);

        // Run program
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }

    /** Calculates divergence of an input vector field
     * See ../glsl/forces.glsl for detailed information
     * @param {*} x 
     */
    computeDivergence(x){
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

        gl.uniform2fv(this.divergenceUniforms.res, this.settings.dataResolution);

        // Set to render to outputTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);

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

        gl.uniform2fv(this.removeDivergenceUniforms.res, this.settings.dataResolution);

        // Set to render to outputTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);

        // Run program
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }

    /**
     * Computes curl of vector field X around vector from vector field V
     * See ../glsl/curl.glsl for detailed information
     * @param {*} x
     */
    computeCurl(x){
        let gl = this.gl;

        // Set up WebGL to use this program and the correct geometry
        gl.useProgram(this.curlProgram);
        gl.bindVertexArray(this.quad.vao);
        gl.enableVertexAttribArray(this.curlProgram.vertexPositionAttribute);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.buffer);
        gl.vertexAttribPointer(this.curlProgram.vertexPositionAttribute, this.quad.itemSize, gl.FLOAT, false, 0, 0);

        // Send uniforms
        gl.uniform1i(this.curlUniforms.x, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, x);

        gl.uniform2fv(this.curlUniforms.res, this.settings.dataResolution);

        // Set to render to outputTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);

        // Run program
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }

    /** Enforces boundary conditions on the given texture
     * See ../glsl/boundary.glsl for detailed information
     * @param {*} x
     * @param {*} coeff 
     */
    enforceBoundary(x, coeff){
        let gl = this.gl;

        // First thing's first, we must copy x to the output texture so that we can copy the quad's data
        // before modifying the boundary data! Otherwise our output will not be defined for the quad itself
        this.copyTexture(x, this.outputTexture);

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

        gl.uniform2fv(this.boundaryUniforms.res, this.settings.dataResolution);
        gl.uniform1f(this.boundaryUniforms.coeff, coeff);

        // Set to render to outputTexture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);

        // We will need to repeat this process with different offsets for each boundary line
        let offsets = [[1, 0], [0, -1], [-1, 0], [0, 1]]; // left, top, right, bottom line order (from boundary.data)
        for(let i = 0; i < 4; i ++){
            gl.uniform2fv(this.boundaryUniforms.offset, offsets[i]);
            gl.drawArrays(gl.LINES, i, 2);
        }
    }


    render(){
        let gl = this.gl;

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

        gl.uniform1i(this.renderUniforms.drawArrows, this.settings.drawArrows);
        gl.uniform2fv(this.renderUniforms.dataRes, this.settings.dataResolution);

        // Run program (and render to screen)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, ...this.settings.renderResolution);
        gl.drawArrays(this.quad.glDrawEnum, 0, this.quad.nItems);
    }

    animate(time){
        let deltaTime = time - this.previousTime;
        this.previousTime = time;
        
        this.update(deltaTime / 1e3);
        this.render();
        this.requestAnimationFrameID = requestAnimationFrame(this.animate.bind(this));
    }

    play(){
        this.requestAnimationFrameID = requestAnimationFrame(this.animate.bind(this));
    }

    pause(){
        let gl = this.gl;
        cancelAnimationFrame(this.requestAnimationFrameID);
        this.requestAnimationFrameID = undefined;
        gl.useProgram(null);
    }

    reset(){
        this.clearTexture(this.dyeTexture);
        this.clearTexture(this.velocityTexture);
    }


    ///////////////////////////////////////// Helper Functions ////////////////////////////////////////////////////////

    clearTexture(tex, r = 0, g = 0, b = 0, a = 0){
        let gl = this.gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.clearColor(r, g, b, a);
        
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    copyTexture(src, dst){
        let gl = this.gl;

        // From https://stackoverflow.com/questions/26303783/webgl-copy-texture-framebuffer-to-texture-framebuffer
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src, 0);

        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.copyFramebuffer);
        gl.viewport(0, 0, ...this.settings.dataResolution);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);

        gl.blitFramebuffer(0, 0, ...this.settings.dataResolution, 0, 0, ...this.settings.dataResolution, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
}