import React from 'react';``
import {mapPropsStream, withState, lifecycle, compose, setObservableConfig, pure} from 'recompose';
import {Observable} from 'rxjs';
import firebase from 'firebase';
import {extend} from 'rx-firebase';
import firebaseConfig from './firebaseConfig';
extend(firebase, Observable);
setObservableConfig({fromESObservable: Observable.from});
firebase.initializeApp(firebaseConfig);

const Bar = ({height, color}) => 
  <div style={{position:'relative', height: 100, width: 50, padding: 1, border: 'solid 1px #d3d3d3'}}>
    <div style={{height: height, backgroundColor: color, width: 50, position: 'absolute', bottom: 0}}/>
  </div>;

const withFirebaseStateObserver = mapPropsStream(props$ =>{
  const state$ = props$.map(props=>props.firebasePath).flatMap(
    path => firebase.database().ref(path).observe('value'));
  return Observable.combineLatest(props$, state$, (props, state) => {
    const {firebasePath, ...otherProps} = props; 
    return {...otherProps, ...state};
  });
});

const deleteFunctionsFields = obj => Object.keys(obj)
      .forEach(prop => { if (typeof obj[prop] === 'function') delete obj[prop]; });

const firebaseStateUpdater = lifecycle({
  componentWillReceiveProps(props){
    const {firebasePath, ...otherProps} = props;
    deleteFunctionsFields(otherProps);
    firebase.database().ref(firebasePath).set(otherProps);
  }
});

const OthersReactiveBar = withFirebaseStateObserver(Bar);

const withReactiveHeightProp = (some$, influence) => mapPropsStream(props$ => {
  const start$ = props$.map(props => props.shouldStart).filter(x=>x).take(1);
  const stop$ = props$.map(props => props.isGameOver).filter(x=>x).take(1);
  const influence$ = start$.flatMap(_=> some$.map(_=>influence).scan((x,y)=>x+y))
      .startWith(0)
      .takeUntil(stop$);

  return Observable.combineLatest(props$, influence$, (props, influence) => {
      return {...props, height: props.height + influence};
  });
});

const withWinnerUpdater = lifecycle({
  componentWillReceiveProps({height, onWin}){
    if (height >= 100) onWin();
  }
});

const withTimeHeightReducer = withReactiveHeightProp(Observable.interval(200), -1);
const withTouchHeightIncrease = withReactiveHeightProp(Observable.fromEvent(document, 'touchstart'), 1);

const myBarDecorators = compose(
  withTimeHeightReducer, 
  withTouchHeightIncrease,
  withWinnerUpdater,
  firebaseStateUpdater,
  pure)

const MyReactiveBar = myBarDecorators(Bar);

const withFormState = withState('formState', 'setFormState', {});
const EnterGameFormRenderer = ({onEnterRoom, formState, setFormState}) =>
  <div>
    <label>Your Name:<br/>
      <input type="text" 
        value={formState.name || ''} 
        onChange={e=>setFormState({...formState, name: e.target.value})}/>
    </label>
    <br/><br/>
    <label>Room:<br/>
      <input type="text" 
        value={formState.room || ''}
        onChange={e=>setFormState({...formState, room: e.target.value.toLowerCase()})}/>
    </label>
    <br/><br/>
    <input type="submit" value="Submit" onClick={()=>onEnterRoom(formState)}/>
  </div>;

const EnterGameForm = withFormState(EnterGameFormRenderer);

const onWinner = (room, winner) => {
  firebase.database().ref(`${room}/isGameOver`).set(true);
  firebase.database().ref(`${room}/winner`).set(winner);  
}

const RoomRenderer = ({room, name: myName, color: myColor, role: myRole, winner, players, shouldStart=false, isGameOver=false})=>
  <div>
    Room: {room}<br/><br/>
    Hi {myName}, let's wait for other players to join.<br/>     
    Your Role is {myRole}.<br/><br/>
    {players ? <div>Players({Object.keys(players).length}): 
    {Object.keys(players)
      .map(playerName=>
        <div style={{display: 'inline-block', color: players[playerName].color}}>{playerName }</div>)}
      </div>: null}
    <br/>
    {
      myRole === 'admin' ?
        <input type="submit" value="Start game" 
          onClick={()=>firebase.database().ref(`${room}/shouldStart`).set(true)} /> :
        null
    }
    {winner ? 
      <div style={{fontSize: 50, color: players[winner].color, fontWeight: 'bold', width: '100%', textAlign: 'center'}}>
        {winner}!!!
      </div> :
      <br/>}
    <br/>
    <div>
      <MyReactiveBar firebasePath={`${room}/bars/${myName}`} onWin={()=>onWinner(room, myName)}
      isGameOver={isGameOver}
      height={50} color={myColor} shouldStart={shouldStart} />
        {Object.keys(players)
          .filter(name=>name!==myName)
          .map(playerName => <OthersReactiveBar key={playerName} firebasePath={`${room}/bars/${playerName}`} 
          isGameOver={isGameOver}/>)}
    </div>
  </div>;

const ReactiveRoom = withFirebaseStateObserver(RoomRenderer);

const Room = props => <ReactiveRoom 
firebasePath={props.room} {...props} />;

const withAppState = withState('appState', 'setAppState', {});
const GameRenderer = ({appState, setAppState}) => 
  <div style={{width:'100%', height: 400, display: 'inline-block'}}>
    {
      appState.room ?
        <Room {...appState} /> : 
        <EnterGameForm onEnterRoom={({room, name}) => {
          firebase.database().ref(`${room}/players`).once('value', playersSnapshot =>{
            const players = playersSnapshot.val();
            const me = players && players[name] ? players[name] :
            { 
              role: players ? 'player' : 'admin',
              color: "#"+((1<<24)*Math.random()|0).toString(16)
            };
            
            setAppState({room, name, ...me});
            firebase.database().ref(`${room}/players/${name}`).set(me);
          });
        }}/>
    }
  </div>;

export default withAppState(GameRenderer);