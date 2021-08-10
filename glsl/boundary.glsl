#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

in vec2 fragUV;         // UV coordinates for this fragment
out vec4 cellValue;     // Output value for this fragment

uniform sampler2D data; // The data to apply the boundary condition to
uniform vec2 res;       // The texture resolution
uniform vec2 offset;    // The offset in XY units to the inner neighbor
uniform float scale;    // The scaling to apply to the neighbor value


void main(){
    cellValue = scale * texture(data, fragUV + offset / res);
}