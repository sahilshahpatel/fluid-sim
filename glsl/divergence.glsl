#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif


// Program Description:
// ----------------------------------------------------------------------------------------------------------------------
// Computes the divergence of a given vector field
// ----------------------------------------------------------------------------------------------------------------------

in vec2 fragUV;                 // Fragment position with [0, 1] coordinates and bottom-left origin
out vec4 div;                   // The divergence for this cell

uniform sampler2D x;            // The vector field
uniform vec2 res;               // Texture resolution


void main(){
    // Get neighboring cell's data
    vec4 left  = texture(x, fragUV + vec2(-1,  0) / res);
    vec4 right = texture(x, fragUV + vec2( 1,  0) / res);
    vec4 down  = texture(x, fragUV + vec2( 0, -1) / res);
    vec4 up    = texture(x, fragUV + vec2( 0,  1) / res);

    div = (right - left + up - down) * 0.5;
}