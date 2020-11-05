#### 👋 You didn't yet get the recording?
#### [**register here**](https://doklist.typeform.com/to/pD4XeOzC)

# What's on this page:
- [How to import our Frustration Free Webinar slides into your Roam](#import-our-slides--your-roam)
- [iOS shortcut for `share to` functionality](#ios-shortcut-for-share-to-functionality)
- [Automatic dark/light mode with `roam/css` page](#automatic-darklight-mode)
- [Top plugins for Mobile and Tablet Roam (iOS and Android)](#top-plugins-for-mobile-roam)
- [How to install plugins in Roam](#how-to-install-plugins-in-roam)

# Import our slides 👉 your Roam
If you want to see how we created our slides for the presentation in Roam, follow these two steps:
1. download the `.md` formatted file from [Webinar Slides](https://raw.githubusercontent.com/thesved/thesved.github.io/main/Frustration-Free-Roam-Webinar-Slides.md), [Office Hours Slides](https://raw.githubusercontent.com/thesved/thesved.github.io/main/Frustration-Free-Roam-Office-Hours.md)
2. import into Roam:

![](https://firebasestorage.googleapis.com/v0/b/firescript-577a2.appspot.com/o/imgs%2Fapp%2FViktor%2FzS-auhqWH3.png?alt=media&token=76c7bd4c-f387-4b9d-89a5-1ff7492c061a)

# Install plugins from webinar
### iOS shortcut for `share to` functionality
1. install this shortcut: [link](https://www.icloud.com/shortcuts/a9e45858154046d7bd3c62158a045a9c)
2. you can `share to` URLs or tweets to Roam now: [demonstration](https://twitter.com/ViktorTabori/status/1279070166433902592)

_note:_ this function is available on Android if you add the RoamResearch website to your home screen from Chrome, you don't need an extension for that

### Automatic dark/light mode
1. go to `roam/css` page
2. create a new code block and set it to CSS, or copy this text:
\`\`\`css\`\`\`
3. copy the content of this page to the code block:
https://viktoroam.glitch.me/roamCSS-auto.css
4. and it should work 😉
5. bonus: example to [change font type to Lato in Roam](https://raw.githubusercontent.com/thesved/thesved.github.io/main/change-font-lato.css)

### Top plugins for Mobile Roam
_see next section to how to install them_
- Gallery to make images work: [link](https://gist.github.com/thesved/6574586e102332ab4a010e3dfaa9c4e7)
- Mobile long tap for right click on Mobile / Tablet: [link](https://gist.github.com/thesved/48cab2307cf0598fcc5cd37643d36cb4)
- Day name for roam dates (eg. [[October 29th, 2020]] -> [[2020.10.29 Thursday]]): [link](https://gist.github.com/thesved/e61fef8b3e5a50ac1ae1362e72da88cf)
- Relative block links (prev/next we used in our presentation): [link](https://gist.github.com/thesved/adb077f8f16082a64b21c70c6ea511ce)

### How to install plugins in Roam
1. go to `roam/js` page
2. create a block with the name of the plugin
3. indent a new block under it (hit `enter` and then hit `tab`)
4. write this text into it: `{{[[roam/js]]}}`
4. indent a new block under it (hit `enter` and then hit `tab`)
5. copy this text into it: \`\`\`javascript\`\`\`
6. copy the code of the script
7. click on `Yes, I know what I am doing`, _note_: you must trust the author of the code
![](https://firebasestorage.googleapis.com/v0/b/firescript-577a2.appspot.com/o/imgs%2Fapp%2FViktor%2Fc9cOp2Ot0y.png?alt=media&token=343f06f9-d5d0-48fa-ad0a-0101509fa749)
8. to have more than one plugin repeat from `step 2`
![](https://firebasestorage.googleapis.com/v0/b/firescript-577a2.appspot.com/o/imgs%2Fapp%2FViktor%2FclvDLa2pzo.png?alt=media&token=e5e1b668-4a1a-4550-96ac-4be06381be65)
