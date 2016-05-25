# The Last Pickle Website

**Note:** Changes to the `master` branch in this repo are automatically reflected on the live site. 

See the Wiki for workflow and other information.

# Local development

## Intro

Github pages doesn't allow for any jekyll plugins; and becuase this site was built by a bunch of frontend 
nerds it needed to use front-end automation tools and workflows (sass, auto-prefix, etc.) So we've taken 
the heavy lifting away form github and put it in the capable hands of [Gulp](http://gulpjs.com).

This process has two parts. The first one is the Jekyll’s _config.yml configuration and the creation of a 
new folder we are going to have our development files, and our gulpfile.js configuration/setup.

### Part 1: Jekyll

The `./_config.yml` file contains the following exclude statement which prevents files/directories from 
the conversion. These exclusions are relative to the site’s source directory and cannot be outside the source directory.

```yaml
exclude:
  ["_dev","gulpfile.js","node_modules","package.json","npm-shrinkwrap.json"]
```
The _dev folder is where we keep our sass and js source files which we don’t want to be visible to the website.

### Part 2: Gulp

Gulp is a node package what we're going to use to compile our assets files (see the `./_dev` folder); and also
serve jekyll for local development/testing.

## Install required tools

### Step one: Install NPM/Node

Ensure you have Node and NPM installed. If you're on a Mac you're likely going to be tempted to use
Homebrew to install Node. DON'T. Just get it from the [official site](https://nodejs.org/en/download/), you'll 
save youself a lot of headaches. If you're on Linux then you know what you're doing anyway.

### Step two: Install Bundler

Ensure you have [Bundler](http://bundler.io) installed. This will help install all the local Ruby deps 
to get Jekyll working locally.

## Install Dependancies

### Step one: Install Gems

From the site's root run `bundle install` which will install the Ruby dependancies in the `Gemfile` in 
the root of the site.

### Step two: Install Node modules

From the site's root run `npm install` which will install all the dependancies in the `package.json` file 
in the root of the site.

## Run site locally

From the site's root run `gulp`. This will compile the Sass and JS and start the jekyll service. It will also 
watch the `_dev/src` folder for any Sass or Js changes. Once you're done you can hit `<control>+c` to stop 
the gulp process.

## The `_data` folder

### assets.json

Gulp will generate a file: `_data/assets.json`. This file contains a JSON object with 
asset includes (js and CSS). This data is then used in the `_includes/pre.html` and `_includes/post.html` 
files to include cache-busted assets. Prety nifty.

### staff.yml

This is essentially your staff database. _All_ staff information is stored in here. For examole:

```yaml
"Aaron Morton"
  name: "Aaron Morton"
  role: "Principal Consultant"
  bio: !xml >
    <p>Aaron Morton has been working with software for over 17 years. In 2011 he left a position at the VFX company Weta Digital in Wellington to pursue his interests in Cassandra. Since then he's been helping clients around the world get the best out of Cassandra. While contributing to the project and the community through involvement in the user list and IRC channels, and code contributions.</p>
    <p>At Weta Digital he piloted the use of Cassandra to provide database services that could stand up to the render farm of 35,000 cores. The key concern at Weta was how to design a scalable persistence layer they could maintain availability in the face of hardware failure and errant clients.</p>
    <p>Prior to Weta he worked on large E-Commerce projects in London and created a Content Management System for the National BBC Radio stations.</p>
    <p>Aaron frequently <a href="/speaking">speaks</a> at meetups and conferences such as the DataStax Cassandra Summits and the Apache Software Foundation's ApacheCon. He runs the <a href="http://www.meetup.com/Data-Driven-Wellington/">Data Driven Wellington</a> meetup group to encourage local engineers to explore new technology. Aaron is also a committer for Apache Cassandra and was voted a DataStax MVP for Apache Cassandra by the community.</p>
  github: aaronmorton
  twitter: aaronmorton
  linkedin: http://www.linkedin.com/in/aaronmortonnz
  email: aaron@thelastpickle.com
  avatar_tn: aaron-morton-tn.jpg # post.author | slugify
  avatar: aaron-morton.jpg # post.author | slugify
```

So when you have a new staff member ensure their complete information is entered into this yaml 
file. Note that the `bio` section is in HTML.

## Questions

If you're having problems or have any questions that Stackoverflow can't help you with you could 
[check here](https://codegaze.github.io/2016/01/09/a-jekyll-workflow-with-gulp/) for more info on 
the frontend automation processes. And if you're still having trouble you can [email Darren at The Fold](mailto:darren@thefold.co.nz).