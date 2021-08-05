#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif


in vec2 fragUV;             // UV coordinates of this fragment
out vec4 cellValue;         // The next value for this cell

uniform sampler2D data;     // Sampler for previous data texture
uniform vec2 mousePos;      // The mouse position in XY coordinates
uniform vec2 mouseVel;      // The mouse velocity in XY coordinates
uniform float radius;       // The falloff radius to use
uniform float dt;           // The time delta for this frame
uniform vec2 res;           // THe resolution for the texture


void main(){
    vec2 fragXY = fragUV * res - 0.5;
    vec2 dist = fragXY - mousePos;
    float decay = exp(-dot(dist, dist) / radius);
    vec2 impulse = mouseVel * decay * dt;

    vec4 oldValue = texture(data, fragUV);
    cellValue = oldValue + vec4(impulse, 0., 1.);
}