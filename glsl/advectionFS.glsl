#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uPreviousFrame;       // Data from last frame of simulation
uniform sampler2D uPreviousIteration;   // Data from last iteration of Gauss-Seidel method
uniform vec2 uResolution;               // Canvas resolution - 1 for converting to "integer indices"
uniform float uDeltaTime;               // Time since last frame
in vec2 fragUV;                         // Fragment position with [0, 1] coordinates and bottom-left origin

out vec4 fragColor;                     // The final color for this fragment

/* Global Variables */
vec2 fragXY;                            // "World space" coordinates (i.e. the would-be index into the frame buffer)
vec2 fragST;                            // "Texture space" coordinates (i.e. fragXY + vec2(0.5) in order to center the pixels)
vec4 previousFrameData;
vec4 previousIterationData;

/* Function List */
vec4 advection(void);

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
    
    fragColor = advection();
}

/** vec4 advection(void)
DESCRIPTION: Implements advection for all fluid properties (including density and velocity). Advection is the 
             process by which properties move along with velocity. 
INPUTS:      None
OUTPUTS:     The vec4 of properties for this fragment on the next frame after advection
*/
vec4 advection(void){
    // In advection it is again easiest to go backwards. We will find the spot where fluid will flow into the fragment.
    vec2 source = fragXY - previousFrameData.xy * uDeltaTime;

    // The source may not be just one grid cell, so we will use bilinear interpolation
    vec2 i = floor(source) + 0.5; // convert back to ST before texture() call
    vec2 j = fract(source);

    vec4 a = texture(uPreviousFrame,  i / uResolution);
    vec4 b = texture(uPreviousFrame, (i + vec2(1, 0)) / uResolution);
    vec4 c = texture(uPreviousFrame, (i + vec2(0, 1)) / uResolution);
    vec4 d = texture(uPreviousFrame, (i + vec2(1, 1)) / uResolution);

    vec4 inFlow = mix(mix(a, b, j.x), mix(c, d, j.x), j.y);

    return inFlow;
}