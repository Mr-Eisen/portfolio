if (window.safari !== undefined) {
    document.body.classList.add('safari');
}

new TypeIt("#banner-text1", {
    strings: "SENIOR",
    speed: 50,
}).go();
setTimeout(() => {
    new TypeIt("#banner-text2", {
        strings: "VISUAL",
        speed: 55,
    }).go();

}, 800);
setTimeout(() => {
    new TypeIt("#banner-text3", {
        strings: "DESIGNER",
        speed: 90,
    }).go();

}, 1600);
setTimeout(() => {
    new TypeIt("#banner-text4", {
        strings: "Olga Bannova",
        speed: 55,
    }).go();

}, 2400);
setTimeout(() => {
    new TypeIt("#banner-text5", {
        strings: "15+ years of experience",
        speed: 50,
    }).go();

}, 3200);


const inViewport = (entries, observer) => {
    entries.forEach(entry => {
        entry.target.classList.toggle("is-inViewport", entry.isIntersecting);
    });
};

const Obs = new IntersectionObserver(inViewport);
const obsOptions = {};

document.querySelectorAll('.design-experience').forEach(el => {
    Obs.observe(el, obsOptions);
});