#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

// #define DEBUG

uniform sampler2D uData;
uniform vec2 uDataResolution;
in vec2 fragUV;

out vec4 fragColor;

/* Helper Functions */
vec3 drawArrow(void);
vec2 rotate(vec2 p, float a);
float sdTriangle( in vec2 p, in vec2 p0, in vec2 p1, in vec2 p2 );
float sdBox( in vec2 p, in vec2 b );

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
    fragColor = texture(uData, fragUV);
    return;
#else

    vec4 background = vec4(0.02, 0.2, 0.5, 1);
    vec4 fluid = vec4(0.75, 1, 1, 1);

    vec4 data = texture(uData, fragUV);
    float density = data.w;

    // Clamp density to [0, 1] so that it can be a proper alpha
    density = clamp(density, 0., 1.);
    fragColor = mix(background, fluid, density);

    vec3 arrow = drawArrow();

    fragColor = length(arrow) == 0. ? fragColor : vec4(arrow, 1);
#endif
}


const float arrowDensity = 16.;
vec3 drawArrow(void){
    // Velocity should be measured at center for entire arrow
    vec2 cellSelector = normalize(uDataResolution) * arrowDensity;
    vec2 vel = texture(uData, (floor(fragUV * cellSelector)  + 0.5)/ cellSelector).xy;

    if(length(vel) <= 0.) return vec3(0);

    vec2 pos = fragUV * cellSelector;
    vec2 p = (fract(pos) - 0.5) * 2.; // This is [-1, 1] position w/ origin at center of cell

    // Resize and rotate p to orient arrow
    float size = clamp(length(vel / uDataResolution * vec2(16., 10.)), 0.01, 1.);
    p = rotate(p / size, atan(vel.y, vel.x));

    // We will use an SDF to draw over arrows
    float d = sdTriangle(p, vec2(0.1, 0.5), vec2(0.1, -0.5), vec2(0.75, 0));
    d = min(d, sdBox(p - vec2(-0.2, 0), vec2(0.3, 0.1)));

    vec3 color = vec3(1, 0, 0) * (1. - step(0., d));
    return color;
}


vec2 rotate(vec2 p, float a) {
	float s = sin(a);
	float c = cos(a);
	mat2 m = mat2(c, -s, s, c);
	return m * p;
}


// From https://iquilezles.org/www/articles/distfunctions2d/distfunctions2d.htm
float sdTriangle( in vec2 p, in vec2 p0, in vec2 p1, in vec2 p2 )
{
    vec2 e0 = p1-p0, e1 = p2-p1, e2 = p0-p2;
    vec2 v0 = p -p0, v1 = p -p1, v2 = p -p2;
    vec2 pq0 = v0 - e0*clamp( dot(v0,e0)/dot(e0,e0), 0.0, 1.0 );
    vec2 pq1 = v1 - e1*clamp( dot(v1,e1)/dot(e1,e1), 0.0, 1.0 );
    vec2 pq2 = v2 - e2*clamp( dot(v2,e2)/dot(e2,e2), 0.0, 1.0 );
    float s = sign( e0.x*e2.y - e0.y*e2.x );
    vec2 d = min(min(vec2(dot(pq0,pq0), s*(v0.x*e0.y-v0.y*e0.x)),
                     vec2(dot(pq1,pq1), s*(v1.x*e1.y-v1.y*e1.x))),
                     vec2(dot(pq2,pq2), s*(v2.x*e2.y-v2.y*e2.x)));
    return -sqrt(d.x)*sign(d.y);
}

float sdBox( in vec2 p, in vec2 b )
{
    vec2 d = abs(p)-b;
    return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
}