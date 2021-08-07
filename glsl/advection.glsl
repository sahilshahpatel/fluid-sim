#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

in vec2 fragUV;          // UV coordinates of this fragment
out vec4 cellValue;      // The next value for this cell

uniform sampler2D data;  // Quantity to advect (dye or velocity)
uniform sampler2D vel;   // Velocity field
uniform float dt;        // Time delta of frame
uniform vec2 res;        // Resolution of textures


void main(){
    vec2 v = texture(vel, fragUV).xy;
    vec2 sourceUV = fragUV - (v / res) * dt;
    
    cellValue = texture(data, sourceUV);
}