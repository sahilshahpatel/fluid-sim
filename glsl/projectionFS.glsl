#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uPreviousFrame;       // Data from last frame of simulation
uniform sampler2D uPreviousIteration;   // Data from last iteration of Gauss-Seidel method
uniform vec2 uResolution;               // Canvas resolution - 1 for converting to "integer indices"
uniform int uStage;                     // The stage of projection we are in (removing curl or divergence)
in vec2 fragUV;                         // Fragment position with [0, 1] coordinates and bottom-left origin

out vec4 fragColor;                     // The final color for this fragment

/* Constants */
const int STAGE_REMOVE_CURL = 0;
const int STAGE_REMOVE_DIV = 1;

/* Global Variables */
vec2 fragXY;                            // "World space" coordinates (i.e. the would-be index into the frame buffer)
vec2 fragST;                            // "Texture space" coordinates (i.e. fragXY + vec2(0.5) in order to center the pixels)
vec4 previousFrameData;
vec4 previousIterationData;

/* Function List */
float remove_curl(void);
vec2 remove_div(void);

/** void main(void)
DESCRIPTION: The main function of the fragment shader. Implements one iteration of Gauss-Seidel approximation.
INPUTS:      None
OUTPUTS:     Sets the value of fragColor, the output color of this fragment
*/
void main(void){
    // We have three types of coordinates per fragment, each useful in different places:
    //   -- uv: UV coordinates are always in [0, 1] and can be thought of as the percentage along in that direction.
    //          They are most useful when looking at previous frame/iteration data for this fragment since the GLSL
    //          texture() function takes in UV coordinates
    //   -- st: ST coordinates are what I call "texture coordinates," and is what the GPU will convert your UV coordinates 
    //          into inside the texture() call. The most important note is that for an ST coordinate to be exactly on a 
    //          pixel, fract(st) == vec2(0.5). ST coordinates are useful for texture() calls where we want to find neighbors
    //   -- xy: XY coordinates are what I call "world space coordinates." They are exactly equal to ST - vec2(0.5), so that 
    //          pixels are centered at integer coordinates. These are like the 2D array indexes you might use to do this in C.
    fragST = fragUV * uResolution;
    fragXY = fragST - 0.5;

    previousFrameData = texture(uPreviousFrame, fragUV);
    previousIterationData = texture(uPreviousIteration, fragUV);


    // We have two different functions based on if we are removing curl or divergence. We want to remove divergence, but
    // to do so we must first calculate the curl-free portion and then subtract it out. We use a uniform to tell us which
    // stage we are at in order to keep the code in one shader.
    switch(uStage){
        case STAGE_REMOVE_CURL:
        fragColor.x = remove_curl();
        return;

        case STAGE_REMOVE_DIV:
        fragColor = vec4(remove_div(), previousFrameData.zw);
        return;
    }
}


/** float remove_curl(void)
DESCRIPTION: Separates the curl-free and divergence-free portions of the velocity field
INPUTS:      None
OUTPUTS:     The projection value for this fragment
*/
float remove_curl(void){
    // First we find the divergence for this cell, which is based on the velocities of its neighbors
    vec4 left  = texture(uPreviousFrame, (fragST + vec2(-1,  0)) / uResolution);
    vec4 right = texture(uPreviousFrame, (fragST + vec2( 1,  0)) / uResolution);
    vec4 up    = texture(uPreviousFrame, (fragST + vec2( 0, -1)) / uResolution);
    vec4 down  = texture(uPreviousFrame, (fragST + vec2( 0,  1)) / uResolution);

    float div_dot_vel = (right.x - left.x + up.y - down.y) / 2.0;

    // Next we do a Gauss-Seidel iteration to solve for the next frame's velocity
    // This should just be a scalar, so we'll store it in the X component
    left  = texture(uPreviousIteration, (fragST + vec2(-1,  0)) / uResolution);
    right = texture(uPreviousIteration, (fragST + vec2( 1,  0)) / uResolution);
    up    = texture(uPreviousIteration, (fragST + vec2( 0, -1)) / uResolution);
    down  = texture(uPreviousIteration, (fragST + vec2( 0,  1)) / uResolution);

    float p = (left.x + right.x + up.x + down.x - div_dot_vel) / 4.0;

    return p;
}

/** float remove_div(void)
DESCRIPTION: Uses the curl-free portion to calculate the divergence-free portion
INPUTS:      None
OUTPUTS:     The divergence-free velocity for this fragment
*/
vec2 remove_div(){
    // The curl-free portion is the gradient of the calculated p-values
    vec4 left  = texture(uPreviousIteration, (fragST + vec2(-1,  0)) / uResolution);
    vec4 right = texture(uPreviousIteration, (fragST + vec2( 1,  0)) / uResolution);
    vec4 up    = texture(uPreviousIteration, (fragST + vec2( 0, -1)) / uResolution);
    vec4 down  = texture(uPreviousIteration, (fragST + vec2( 0,  1)) / uResolution);

    vec2 curl_free = vec2(
        (right.x - left.x) / 2.0,
        (up.x - down.x) / 2.0
    );

    // The divergence free portion is just the original minus the curl_free portion
    return previousFrameData.xy - curl_free;
}