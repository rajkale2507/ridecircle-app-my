console.log("RideCircle Website Loaded");

/* ================= FAQ ACCORDION =================
   Used on the Contact page. Safe no-op on any page
   that has no .faq-item elements. */

document.addEventListener("DOMContentLoaded", () => {
    const faqItems = document.querySelectorAll(".faq-item");

    faqItems.forEach(item => {
        const question = item.querySelector(".faq-question");
        if (!question) return;

        question.addEventListener("click", () => {
            faqItems.forEach(faq => {
                if (faq !== item) faq.classList.remove("active");
            });
            item.classList.toggle("active");
        });
    });
});
