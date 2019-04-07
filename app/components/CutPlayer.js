/* eslint no-param-reassign: "error" */

import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { Popup } from 'semantic-ui-react';
import uuidV4 from 'uuid/v4';
import log from 'electron-log';
import { changeThumb, addIntervalSheet, addThumb } from '../actions';
import VideoCaptureProperties from '../utils/videoCaptureProperties';
import {
  MINIMUM_WIDTH_OF_CUTWIDTH_ON_TIMELINE,
  MOVIEPRINT_COLORS,
  CUTPLAYER_SLICE_ARRAY_SIZE,
} from '../utils/constants';
import {
  limitRange,
  getHighestFrame,
  getLowestFrame,
  getVisibleThumbs,
  mapRange,
  frameCountToTimeCode,
  setPosition,
  getSliceWidthArrayForCut,
} from '../utils/utils';
import styles from './VideoPlayer.css';
import stylesPop from './Popup.css';

const pathModule = require('path');
const opencv = require('opencv4nodejs');

class CutPlayer extends Component {
  constructor(props) {
    super(props);

    this.state = {
      currentTime: 0, // in seconds
      currentFrame: 0, // in frames
      videoHeight: 360,
      playHeadPosition: 0, // in pixel
      mouseStartDragInsideTimeline: false,
      showPlaybar: false,
    };

    // this.onSaveThumbClick = this.onSaveThumbClick.bind(this);

    this.getCurrentFrameNumber = this.getCurrentFrameNumber.bind(this);
    this.onInPointClick = this.onInPointClick.bind(this);
    this.onOutPointClick = this.onOutPointClick.bind(this);
    this.onBackForwardClick = this.onBackForwardClick.bind(this);
    this.updateOpencvVideoCanvas = this.updateOpencvVideoCanvas.bind(this);
    this.updatePositionWithStep = this.updatePositionWithStep.bind(this);
    this.onDurationChange = this.onDurationChange.bind(this);
    this.updateTimeFromFrameNumber = this.updateTimeFromFrameNumber.bind(this);
    this.updatePositionFromFrame = this.updatePositionFromFrame.bind(this);
    this.onShowPlaybar = this.onShowPlaybar.bind(this);
    this.onHidePlaybar = this.onHidePlaybar.bind(this);

    this.onTimelineClick = this.onTimelineClick.bind(this);
    this.onTimelineDrag = this.onTimelineDrag.bind(this);
    this.onTimelineDragStop = this.onTimelineDragStop.bind(this);
    this.onTimelineMouseOver = this.onTimelineMouseOver.bind(this);
    this.onTimelineExit = this.onTimelineExit.bind(this);
    this.onApplyClick = this.onApplyClick.bind(this);
  }

  componentWillMount() {
    const videoHeight = parseInt(this.props.height - this.props.controllerHeight, 10);
    this.setState({
      videoHeight,
    });
  }

  componentDidMount() {
    if (this.props.selectedThumbsArray.length !== 0) {
      this.updateTimeFromFrameNumber(this.props.selectedThumbsArray[0].frameNumber);
    }
  }

  componentWillReceiveProps(nextProps) {
  }

  componentDidUpdate(prevProps) {
    if (this.props.selectedThumbsArray.length !== 0) {
      if (prevProps.selectedThumbsArray.length !== this.props.selectedThumbsArray.length ||
        prevProps.selectedThumbsArray[0].frameNumber !== this.props.selectedThumbsArray[0].frameNumber) {
        this.updateTimeFromFrameNumber(this.props.selectedThumbsArray[0].frameNumber);
      }
    }
  }

  onShowPlaybar() {
    if (!this.state.showPlaybar) {
      this.setState({
        showPlaybar: true
      });
    }
  }

  onHidePlaybar() {
    if (this.state.showPlaybar) {
      this.setState({
        showPlaybar: false
      });
    }
  }

  getCurrentFrameNumber() {
    let newFrameNumber;
    newFrameNumber = this.state.currentFrame;
    return newFrameNumber
  }

  onInPointClick() {
    const { store } = this.context;
    const newFrameNumber = this.getCurrentFrameNumber();
    store.dispatch(addIntervalSheet(
      this.props.file,
      this.props.settings.currentSheetId,
      this.props.thumbs.length,
      newFrameNumber,
      getHighestFrame(this.props.thumbs),
      this.props.frameSize,
    ));
  }

  onOutPointClick() {
    const { store } = this.context;
    const newFrameNumber = this.getCurrentFrameNumber();
    store.dispatch(addIntervalSheet(
      this.props.file,
      this.props.settings.currentSheetId,
      this.props.thumbs.length,
      getLowestFrame(this.props.thumbs),
      newFrameNumber,
      this.props.frameSize,
    ));
  }

  onBackForwardClick(step) {
    this.updatePositionWithStep(step);
  }

  onDurationChange(duration) {
    // setState is asynchronious
    // updatePosition needs to wait for setState, therefore it is put into callback of setState
    this.setState({ duration }, () => {
      this.updateTimeFromPosition(this.state.playHeadPosition);
    });
  }

  updateOpencvVideoCanvas(currentFrame) {
    console.log(currentFrame);
    const { videoHeight } = this.state
    const vid = this.props.opencvVideo;
    setPosition(vid, currentFrame, this.props.file.useRatio);
    this.opencvCutPlayerCanvasRef.height = videoHeight;
    this.opencvCutPlayerCanvasRef.width = this.props.containerWidth;
    const ctx = this.opencvCutPlayerCanvasRef.getContext('2d');
    const height = vid.get(VideoCaptureProperties.CAP_PROP_FRAME_HEIGHT);
    const width = vid.get(VideoCaptureProperties.CAP_PROP_FRAME_WIDTH);
    const sliceWidthArray = getSliceWidthArrayForCut(vid, CUTPLAYER_SLICE_ARRAY_SIZE);
    const sliceGap = 2;
    const widthSum = sliceWidthArray.reduce((a, b) => a + b, 0);
    const rescaleFactor = (this.props.containerWidth - sliceGap * (CUTPLAYER_SLICE_ARRAY_SIZE - 1)) / widthSum;
    let canvasXPos = 0;

    for (let i = 0; i < CUTPLAYER_SLICE_ARRAY_SIZE; i += 1) {
      const frame = vid.read();
      if (!frame.empty) {
        const sliceWidth = sliceWidthArray[i];
        const sliceXPos = Math.max(Math.floor(width / 2) - Math.floor(sliceWidth / 2), 0);

        const matCropped = frame.getRegion(new opencv.Rect(sliceXPos, 0, sliceWidth, height));
        const matResized = matCropped.rescale(rescaleFactor);

        const matRGBA = matResized.channels === 1 ?
          matResized.cvtColor(opencv.COLOR_GRAY2RGBA) :
          matResized.cvtColor(opencv.COLOR_BGR2RGBA);

        const imgData = new ImageData(
          new Uint8ClampedArray(matRGBA.getData()),
          matResized.cols,
          matResized.rows
        );
        ctx.putImageData(imgData, canvasXPos, 0);
        canvasXPos += (sliceWidthArray[i] * rescaleFactor) + sliceGap;
      }
    }
  }

  updatePositionWithStep(step) {
    const currentFramePlusStep = this.getCurrentFrameNumber() + step;
    this.updatePositionFromFrame(currentFramePlusStep);
    this.updateOpencvVideoCanvas(currentFramePlusStep);
  }

  updatePositionFromFrame(currentFrame) {
    const { containerWidth, file } = this.props;

    if (currentFrame) {
      this.setState({ currentFrame });
      const xPos = mapRange(
        currentFrame,
        0, (file.frameCount - 1),
        0, containerWidth, false
      );
      this.setState({ playHeadPosition: xPos });
    }
  }

  updateTimeFromFrameNumber(currentFrame) {
    const { containerWidth, file } = this.props;

    let xPos = 0;
    let offsetFrameNumber = 0;
    if (currentFrame) {
      const { frameCount } = file;
      // offset currentFrame due to main frame is in middle of sliceArraySize
      const halfArraySize = Math.floor(CUTPLAYER_SLICE_ARRAY_SIZE / 2);
      offsetFrameNumber = limitRange(
        currentFrame - parseInt(halfArraySize, 10),
        0,
        frameCount - 1
      );

      xPos = mapRange(offsetFrameNumber, 0, frameCount - 1, 0, containerWidth, false);
    }
    this.setState({ playHeadPosition: xPos });
    this.setState({ currentFrame: offsetFrameNumber });
    this.updateOpencvVideoCanvas(offsetFrameNumber);
  }

  updateTimeFromPosition(xPos) {
    const { containerWidth, file } = this.props;

    if (xPos) {
      this.setState({ playHeadPosition: xPos });
      const { frameCount } = file;
      const currentFrame = mapRange(xPos, 0, containerWidth, 0, frameCount - 1);
      this.setState({ currentFrame });
      this.updateOpencvVideoCanvas(currentFrame);
    }
  }

  onTimelineClick(e) {
    const bounds = this.timeLine.getBoundingClientRect();
    const x = e.clientX - bounds.left;
    this.updateTimeFromPosition(x);
  }

  onTimelineDrag() {
    this.setState({ mouseStartDragInsideTimeline: true });
  }

  onTimelineMouseOver(e) {
    if (this.state.mouseStartDragInsideTimeline) { // check if dragging over timeline
      const bounds = this.timeLine.getBoundingClientRect();
      const x = e.clientX - bounds.left;
      this.updateTimeFromPosition(x);
    }
  }

  onTimelineDragStop() {
    this.setState({ mouseStartDragInsideTimeline: false });
  }

  onTimelineExit() {
    if (this.state.mouseStartDragInsideTimeline) {
      this.setState({ mouseStartDragInsideTimeline: false });
    }
  }

  onApplyClick = () => {
    // // only do changes if there is a thumb selected
    // if (this.props.thumbs.find((thumb) => thumb.thumbId === this.props.selectedThumbsArray) !== undefined) {
    //   const { store } = this.context;
    //   let newFrameNumber;
    //   newFrameNumber = this.state.currentFrame;
    //   if (this.props.keyObject.altKey || this.props.keyObject.shiftKey) {
    //     const newThumbId = uuidV4();
    //     if (this.props.keyObject.altKey) {
    //       store.dispatch(addThumb(
    //         this.props.file,
    //         this.props.settings.currentSheetId,
    //         newFrameNumber,
    //         this.props.thumbs.find((thumb) => thumb.thumbId === this.props.selectedThumbsArray).index + 1,
    //         newThumbId,
    //         this.props.frameSize,
    //       ));
    //     } else { // if shiftKey
    //       store.dispatch(addThumb(
    //         this.props.file,
    //         this.props.settings.currentSheetId,
    //         newFrameNumber,
    //         this.props.thumbs.find((thumb) => thumb.thumbId === this.props.selectedThumbsArray).index,
    //         newThumbId,
    //         this.props.frameSize,
    //       ));
    //     }
    //     // delay selection so it waits for add thumb to be ready
    //     setTimeout(() => {
    //       this.props.selectThumbMethod(newThumbId, newFrameNumber);
    //     }, 500);
    //   } else { // if normal set new thumb
    //     store.dispatch(changeThumb(this.props.settings.currentSheetId, this.props.file, this.props.selectedThumbsArray, newFrameNumber, this.props.frameSize));
    //   }
    // }
  }

  render() {
    const { playHeadPosition } = this.state;
    const { containerWidth, scaleValueObject } = this.props;
    const { videoHeight } = this.state;

    function over(event) {
      event.target.style.opacity = 1;
    }

    function out(event) {
      event.target.style.opacity = 0.5;
    }

    const inPoint = getLowestFrame(this.props.thumbs);
    const outPoint = getHighestFrame(this.props.thumbs);
    const inPointPositionOnTimeline =
      ((containerWidth * 1.0) / this.props.file.frameCount) * inPoint;
    const outPointPositionOnTimeline =
      ((containerWidth * 1.0) / this.props.file.frameCount) * outPoint;
    const cutWidthOnTimeLine = Math.max(
      outPointPositionOnTimeline - inPointPositionOnTimeline,
      MINIMUM_WIDTH_OF_CUTWIDTH_ON_TIMELINE
    );

    return (
      <div>
        <div
          className={`${styles.player}`}
          style={{
            height: videoHeight,
            width: containerWidth,
          }}
        >
          <Popup
            trigger={
              <button
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  marginTop: '8px',
                  marginRight: '8px',
                  zIndex: 1,
                }}
                className={`${styles.hoverButton} ${styles.textButton}`}
                onClick={this.props.onThumbDoubleClick}
                onMouseOver={over}
                onMouseLeave={out}
                onFocus={over}
                onBlur={out}
              >
                BACK
              </button>
            }
            className={stylesPop.popup}
            content="Back to MoviePrint view"
          />
            <canvas ref={(el) => { this.opencvCutPlayerCanvasRef = el; }} />
          <div
            id="currentTimeDisplay"
            className={styles.frameNumberOrTimeCode}
          >
            {frameCountToTimeCode(this.state.currentFrame, this.props.file.fps)}
          </div>
        </div>
        <div className={`${styles.controlsWrapper}`}>
          <div
            id="timeLine"
            className={`${styles.timelineWrapper}`}
            onClick={this.onTimelineClick}
            onMouseDown={this.onTimelineDrag}
            onMouseUp={this.onTimelineDragStop}
            onMouseMove={this.onTimelineMouseOver}
            onMouseLeave={this.onTimelineExit}
            ref={(el) => { this.timeLine = el; }}
          >
            <div
              className={`${styles.timelinePlayhead}`}
              style={{
                left: Number.isNaN(playHeadPosition) ? 0 : playHeadPosition,
              }}
            />
            <div
              className={`${styles.timelineCut}`}
              style={{
                left: Number.isNaN(inPointPositionOnTimeline) ? 0 : inPointPositionOnTimeline,
                width: Number.isNaN(cutWidthOnTimeLine) ? 0 : cutWidthOnTimeLine,
              }}
            />
          </div>
          <div className={`${styles.buttonWrapper}`}>
            <Popup
              trigger={
                <button
                  className={`${styles.hoverButton} ${styles.textButton} ${styles.hundredFramesBack}`}
                  onClick={() => this.onBackForwardClick(-100)}
                  onMouseOver={over}
                  onMouseLeave={out}
                  onFocus={over}
                  onBlur={out}
                >
                  {'<<<'}
                </button>
              }
              className={stylesPop.popup}
              content={<span>Move 100 frames back</span>}
            />
            <Popup
              trigger={
                <button
                  className={`${styles.hoverButton} ${styles.textButton} ${styles.tenFramesBack}`}
                  onClick={() => this.onBackForwardClick(-10)}
                  onMouseOver={over}
                  onMouseLeave={out}
                  onFocus={over}
                  onBlur={out}
                >
                  {'<<'}
                </button>
              }
              className={stylesPop.popup}
              content={<span>Move 10 frames back</span>}
            />
            <Popup
              trigger={
                <button
                  className={`${styles.hoverButton} ${styles.textButton} ${styles.oneFrameBack}`}
                  onClick={() => this.onBackForwardClick(-1)}
                  onMouseOver={over}
                  onMouseLeave={out}
                  onFocus={over}
                  onBlur={out}
                >
                  {'<'}
                </button>
              }
              className={stylesPop.popup}
              content={<span>Move 1 frame back</span>}
            />
            <Popup
              trigger={
                <button
                  className={`${styles.hoverButton} ${styles.textButton}`}
                  onClick={this.onApplyClick}
                  onMouseOver={over}
                  onMouseLeave={out}
                  onFocus={over}
                  onBlur={out}
                  style={{
                    display: this.props.selectedThumbsArray ? 'block' : 'none',
                    transformOrigin: 'center bottom',
                    transform: 'translateX(-50%)',
                    position: 'absolute',
                    bottom: 0,
                    left: '50%',
                    color: MOVIEPRINT_COLORS[0]
                  }}
                >
                  {this.props.keyObject.altKey ? 'ADD AFTER' : (this.props.keyObject.shiftKey ? 'ADD BEFORE' : 'CHANGE')}
                </button>
              }
              className={stylesPop.popup}
              content={this.props.keyObject.altKey ? (<span>Add a new thumb <mark>after</mark> selection</span>) : (this.props.keyObject.shiftKey ? (<span>Add a new thumb <mark>before</mark> selection</span>) : (<span>Change the thumb to use this frame | with <mark>SHIFT</mark> add a thumb before selection | with <mark>ALT</mark> add a thumb after selection</span>))}
            />
            <Popup
              trigger={
                <button
                  className={`${styles.hoverButton} ${styles.textButton} ${styles.oneFrameForward}`}
                  onClick={() => this.onBackForwardClick(1)}
                  onMouseOver={over}
                  onMouseLeave={out}
                  onFocus={over}
                  onBlur={out}
                >
                  {'>'}
                </button>
              }
              className={stylesPop.popup}
              content={<span>Move 1 frame forward</span>}
            />
            <Popup
              trigger={
                <button
                  className={`${styles.hoverButton} ${styles.textButton} ${styles.tenFramesForward}`}
                  onClick={() => this.onBackForwardClick(10)}
                  onMouseOver={over}
                  onMouseLeave={out}
                  onFocus={over}
                  onBlur={out}
                >
                  {'>>'}
                </button>
              }
              className={stylesPop.popup}
              content={<span>Move 10 frames forward</span>}
            />
            <Popup
              trigger={
                <button
                  className={`${styles.hoverButton} ${styles.textButton} ${styles.hundredFramesForward}`}
                  onClick={() => this.onBackForwardClick(100)}
                  onMouseOver={over}
                  onMouseLeave={out}
                  onFocus={over}
                  onBlur={out}
                >
                  {'>>>'}
                </button>
              }
              className={stylesPop.popup}
              content={<span>Move 100 frames forward</span>}
            />
          </div>
        </div>
      </div>
    );
  }
}

const mapStateToProps = state => {
  const { visibilitySettings } = state;
  const { settings, sheetsByFileId } = state.undoGroup.present;
  const { currentFileId } = settings;

  const allThumbs = (sheetsByFileId[currentFileId] === undefined ||
    sheetsByFileId[currentFileId][settings.currentSheetId] === undefined)
    ? undefined : sheetsByFileId[currentFileId][settings.currentSheetId].thumbsArray;
  return {
    thumbs: getVisibleThumbs(
      allThumbs,
      visibilitySettings.visibilityFilter
    ),
    settings,
    visibilitySettings
  };
};

CutPlayer.contextTypes = {
  store: PropTypes.object,
  thumbId: PropTypes.number,
  positionRatio: PropTypes.number,
  setNewFrame: PropTypes.func,
  closeModal: PropTypes.func,
};

CutPlayer.defaultProps = {
  // currentFileId: undefined,
  file: {
    id: undefined,
    width: 640,
    height: 360,
    columnCount: 4,
    frameCount: 16,
    fps: 25,
    path: '',
  },
  height: 360,
  selectedThumbsArray: [],
  width: 640,
  thumbs: undefined,
};

CutPlayer.propTypes = {
  aspectRatioInv: PropTypes.number.isRequired,
  controllerHeight: PropTypes.number.isRequired,
  file: PropTypes.shape({
    id: PropTypes.string,
    width: PropTypes.number,
    height: PropTypes.number,
    columnCount: PropTypes.number,
    frameCount: PropTypes.number,
    fps: PropTypes.number,
    path: PropTypes.string,
    useRatio: PropTypes.bool,
  }),
  height: PropTypes.number,
  keyObject: PropTypes.object.isRequired,
  onThumbDoubleClick: PropTypes.func.isRequired,
  selectedThumbsArray: PropTypes.array,
  selectThumbMethod: PropTypes.func.isRequired,
  width: PropTypes.number,
  // settings: PropTypes.object.isRequired,
  thumbs: PropTypes.array,
  // sheetsByFileId: PropTypes.object,
  // visibilitySettings: PropTypes.object.isRequired,
};

export default connect(mapStateToProps)(CutPlayer);
