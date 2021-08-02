#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif


// Program Description:
// ----------------------------------------------------------------------------------------------------------------------
// Computes the curl of a given vector field
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

    vec2 grad = vec2(right.x - left.x, up.y - down.y) * 0.5;
    vec2 u = texture(x, fragUV).xy;

    curl = vec4(cross(vec3(grad, 0.), vec3(u, 0.)), 0.);
}