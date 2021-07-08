#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

#define DEBUG;

uniform sampler2D uPreviousFrame;
in vec2 fragUV;

out vec4 fragColor;

/**
The renderer simply converts fluid simulation data into a visual 
representation. The simulator may keep track of many variables 
like velocity and density or even temperature. The renderer needs 
only the data relevant to the current frame, which in this case is 
the density.
*/
void main(void){
#ifdef DEBUG
    // In Debug mode, just show the simulation data
    fragColor = texture(uPreviousFrame, fragUV);
#else
    vec4 background = vec4(0.02, 0.2, 0.5, 1);
    vec4 fluid = vec4(1, 1, 1, 1);

    float density = texture(uPreviousFrame, fragUV).w;

    // TODO: This implies that density is in [0, 1] which is not actually true
    fragColor = mix(background, fluid, density);
#endif
}