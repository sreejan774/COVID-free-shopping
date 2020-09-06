require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const session = require('express-session');
const passport = require('passport');
const passportLocalMongoose = require("passport-local-mongoose");

const app = express();

app.use(express.static("public"));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({
  extended: true
}));

app.use(session({
  secret: process.env.SECRET, //fetch secret from .env file
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

mongoose.connect('mongodb://localhost:27017/userDB', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
mongoose.set("useCreateIndex", true);

const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  waiting: [{ token: Number, otp: Number }],
  processing: [{ token: String, otp: Number }],
  count: Number,
  maxCustomers: Number,
  currToken: Number
});

//adding passport local mongoose plugin to schema
userSchema.plugin(passportLocalMongoose);

const User = new mongoose.model('User', userSchema);

passport.use(User.createStrategy());

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

//----------------------------get----------------------------------

app.get('/', function(req, res) {
  res.render('home');
});

app.get('/login', function(req, res) {
  res.render('login');
});

let message = "";
app.get('/register', function(req, res) {
  res.render('register',{msg : message});
});

app.get('/dashboard', function(req, res) {
  if (req.isAuthenticated()) {
    res.render("dashboard",{nextButtonMsg: "", waitingListMsg: "", currToken: req.user.currToken});
  } else {
    redirect('/login');
  }
});

app.get('/settings', function(req, res) {
  if (req.isAuthenticated()) {
    res.render("settings");
  } else {
    redirect('/login');
  }
});

app.get('/enter', function(req, res) {
  res.render('enter');
});

app.get('/exit', function(req, res) {
  res.render('exit');
});


app.get("/logout", function(req, res) {
  req.logout();
  res.redirect('/');
});


//----------------------------post----------------------------------

app.post('/next',function(req,res){
  if(req.isAuthenticated()){
    let nextButtonMsg = '' ;
    let waitingListMsg = String(req.user.waiting.length) + " is the Queue remaining" ;
    if(req.user.waiting.length == 0){
      //no one to call no change in currToken
      nextButtonMsg = "No one to call"
      res.render('dashboard',{nextButtonMsg: nextButtonMsg, waitingListMsg: waitingListMsg, currToken: req.user.currToken});
    }
    else if(req.user.processing.length == req.user.maxCustomers){
      //limit exceed no change in currToken
      nextButtonMsg = "Limit Exceed";
      res.render('dashboard',{nextButtonMsg: nextButtonMsg, waitingListMsg: waitingListMsg, currToken: req.user.currToken});
    }
    else{
        //currToken is increased by 1 and 1 customer is processed
        waitingListMsg = String(req.user.waiting.length - 1) + " is the Queue remaining" ;
        let displayToken = req.user.currToken + 1;
        let waitingArr = req.user.waiting;
        let processingArr = req.user.processing;
        // shift removes first element from array and returns it
        let first = waitingArr.shift();
        //pushing first element into processing array
        processingArr.push(first)
        User.updateOne({_id: req.user.id}, { waiting: waitingArr, processing: processingArr, currToken: displayToken}, function(err){
          if(err){
            console.log(err);
          }
        });
        res.render('dashboard',{nextButtonMsg: nextButtonMsg, waitingListMsg: waitingListMsg, currToken: displayToken});
    }
  }else{
    res.redirect('/login');
  }
});



app.post('/setLimit', function(req, res) {
  maxCustomers = Number(req.body.maxCustomers);
  if (req.isAuthenticated()) {
    User.updateOne({ _id: req.user.id}, { maxCustomers: maxCustomers }, function(err) {
      if (err) {
        console.log(err);
      } else {
        res.redirect('/settings');
      }
    });
  } else {
    res.redirect('/login');
  }
});


app.post('/reset', function(req, res) {
  if (req.isAuthenticated()) {
    User.updateOne({_id: req.user.id}, { waiting: [], processing: [], count: 0, currToken: 0}, function(err) {
      if (err) {
        console.log(err);
      } else {
        res.redirect('/settings');
      }
    });
  } else {
    res.redirect('/login');
  }
});

app.post('/exit', function(req, res) {
  //console.log(req.body);
  let username = req.body.username;
  let token = Number(req.body.token);
  let otp = Number(req.body.otp);

  User.findOne({ username: username }, function(err, user) {
    if (err) {
      console.log(err);
    } else {
      let index = checkValidity(token, otp, user.processing, user.count);
      if (index == -1) {
        let msg = "Invalid Entry"
        res.render('message',{msg: msg});
      } else {
        let arr = user.processing;
        arr.splice(index, 1);
        console.log(arr.processing);
        User.updateOne({ username: username },{ processing: arr }, function(err) {
          if (err) {
            console.log(err);
          } else {
            let msg = "Thanks for visiting !"
            res.render('message',{msg: msg});
          }
        });
      }
    }
  });
});


app.post('/enter', function(req, res) {
  if(req.body.name == "generate"){
    User.findOne({ username: req.body.username }, function(err, user) {
      if (err) {
        console.log(err);
      } else {

        //if username is not found while generating token
        if(user == null){
          let msg = "Username does not exist." ;
          res.render('message',{msg: msg});
        }else{
          let newToken = user.count + 1;
          let newCount = user.count + 1;
          let updatedWaiting = user.waiting;
          let OTP = generateOTP(user.waiting, user.processing);
          updatedWaiting.push({
            token: newToken,
            otp: OTP
          });
          User.updateOne({ username: req.body.username }, { waiting: updatedWaiting, count: newCount }, function(err) {
            if (err) {
              console.log(err);
            } else {
              res.render('token',{token: newToken, otp: OTP});
            }
          });
        }
        }
    });
  } else {
    // liveStatus route
    User.findOne({ username: req.body.username }, function(err, user) {
      if (err) {
        console.log(err);
      } else {

        //if username is not found while generating token
        if(user == null){
          let msg = "Username does not exist." ;
          res.render('message',{msg: msg});
        }else{
          let msg = "Current Token : " + String(user.currToken);
          res.render('message', {msg: msg});
        }
      }
    });
  }

});


app.post('/register', function(req, res) {
  //console.log(req.body.username);

  //finds whether username exists or not
  User.findOne({username: req.body.username}, function(err,user){
    if(err){
      console.log(err);
    }else{
      //if no user with the given username is found then create user else change message
      if(user == null){
        User.register({ username: req.body.username }, req.body.password, function(err, user) {
          if (err) {
            message = "";
            res.redirect("/register");
          } else {
            passport.authenticate("local")(req, res, function() {
              //first time automatic resetting
              User.updateOne({_id: req.user.id},{waiting: [], processing: [], count: 0, currToken: 0, maxCustomers: 0},function(err){
                if(err){
                  console.log(err);
                }
              });
              res.redirect("/settings");
            });
          }
        });
      }else{
        message = "A user with this username already exists. Try a different username";
        res.redirect("/register");
      }
    }
  });


});

app.post('/login', function(req, res) {
  const user = new User({
    username: req.body.username,
    password: req.body.password
  });

  req.login(user, function(err) {
    if (err) {
      console.log(err);
    } else {
      passport.authenticate('local')(req, res, function() {
        let waitingListMsg = String(req.user.waiting.length) + " is the Queue remaining" ;
        res.render('dashboard',{nextButtonMsg: "", waitingListMsg: waitingListMsg, currToken: req.user.currToken});
      });
    }
  });

});

//-------------------------------functions----------------------------
function generateOTP(waiting, processing) {
  let digits = '0123456789';
  while (true) {
    let OTP = '';
    for (let i = 0; i < 4; i++) {
      OTP += digits[Math.floor(Math.random() * 10)];
    }
    OTP = Number(OTP);
    //check if exists or not
    let i = 0;
    let flag = false;
    for (i = 0; i < waiting.length; i++) {
      if (OTP == waiting[i].otp) {
        flag = true;
        break;
      }
    }
    if (flag == true) {
      continue;
    }

    for (i = 0; i < processing.length; i++) {
      if (OTP == processing[i].otp) {
        flag = true;
        break;
      }
    }
    if (flag == false) {
      return OTP;
    }
  }
}

//this function checks whether token matches with the otp or not
function checkValidity(token, otp, processing, count) {
  if (count == 0) {
    return -1;
  }
  let i = 0;
  for (i = 0; i < processing.length; i++) {
    if (processing[i].token == token && processing[i].otp == otp) {
      return i;
    }
  }
  return -1;
}

app.listen(3000, function(req, res) {
  console.log("server running at port 3000");
});
