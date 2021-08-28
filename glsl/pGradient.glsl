#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

in vec2 fragUV;             // UV coordinates of this fragment
out vec4 cellValue;         // The output value of this cell

uniform sampler2D vel;      // The velocity vector field
uniform sampler2D pressure; // The pressure field
uniform vec2 res;           // The texture resolution

void main(){
    float left  = texture(pressure, fragUV - vec2(1, 0) / res).x;
    float right = texture(pressure, fragUV + vec2(1, 0) / res).x;
    float down  = texture(pressure, fragUV - vec2(0, 1) / res).x;
    float up    = texture(pressure, fragUV + vec2(0, 1) / res).x;

    vec2 gradient = vec2(right - left, up - down) * 0.5;

    vec2 oldVel = texture(vel, fragUV).xy;

    cellValue = vec4(oldVel - gradient, 0., 0.);
}