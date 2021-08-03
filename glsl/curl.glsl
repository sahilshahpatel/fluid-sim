#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif


// Program Description:
// ----------------------------------------------------------------------------------------------------------------------
// Computes the curl of a given 2D vector field
// ----------------------------------------------------------------------------------------------------------------------

in vec2 fragUV;                 // Fragment position with [0, 1] coordinates and bottom-left origin
out vec4 curl;                  // The curl for this cell

uniform sampler2D x;            // The vector field
uniform vec2 res;               // Texture resolution


void main(){
    // Get neighboring cell's data
    vec4 left  = texture(x, fragUV + vec2(-1,  0) / res);
    vec4 right = texture(x, fragUV + vec2( 1,  0) / res);
    vec4 down  = texture(x, fragUV + vec2( 0, -1) / res);
    vec4 up    = texture(x, fragUV + vec2( 0,  1) / res);

    float dfx = right.x - left.x;
    float dfy = up.y - down.y;

    // Curl of a 2D vector field is always in the Z component
    // See https://en.wikipedia.org/wiki/Curl_(mathematics)#Usage
    curl = vec4(0, 0, dfy - dfx, 0) * 0.5;
}